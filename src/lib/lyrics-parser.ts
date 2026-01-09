/**
 * Lyrics parsing utilities for LRC, SRT, and TTML formats
 * Used by Apple Music-style lyrics to support gamdl downloaded files
 * Supports word-by-word timing from Apple Music syllable-lyrics
 */

export interface LyricsSyllable {
    time: number     // Start time in seconds
    endTime?: number // End time in seconds
    text: string     // The syllable text
}

export interface LyricsWord {
    time: number     // Start time in seconds
    endTime?: number // End time in seconds
    text: string     // The full word text
    syllables?: LyricsSyllable[] // Per-syllable timing (for compound words)
    transliteration?: string // Romanized pronunciation (e.g., "sa rang" for 사랑)
}

export interface LyricsLine {
    time: number    // Start time in seconds
    endTime?: number // End time in seconds (optional, for SRT/TTML)
    text: string
    words?: LyricsWord[] // Word-level timing (optional, for syllable-lyrics)
    agent?: string // Singer/vocalist identifier (v1=main, v2=featured, v1000=both)
    translation?: string // Translated text for this line
}

export interface ParsedLyrics {
    synced: boolean
    lines: LyricsLine[]
    format: 'lrc' | 'srt' | 'ttml' | 'plain'
    hasWordTiming?: boolean // True if word-by-word timing is available
    hasTranslation?: boolean // True if translations are available
    hasTransliteration?: boolean // True if romanization is available
    translationLanguage?: string // e.g., 'en-US'
    transliterationLanguage?: string // e.g., 'ko-Latn'
    songwriters?: string[] // List of songwriters/composers
}

/**
 * Parse LRC (Lyrics) file format
 * Format: [MM:SS.xx]Text or [MM:SS:xx]Text
 * Example: [00:12.50]First verse lyrics
 */
export function parseLRC(content: string): ParsedLyrics {
    const lines: LyricsLine[] = []
    const lrcLines = content.split('\n')

    // LRC timestamp pattern: [MM:SS.xx] or [MM:SS:xx]
    const timestampRegex = /^\[(\d{2}):(\d{2})([.:])(\d{2})\](.*)/

    for (const line of lrcLines) {
        const match = line.match(timestampRegex)
        if (match) {
            const minutes = parseInt(match[1], 10)
            const seconds = parseInt(match[2], 10)
            const centiseconds = parseInt(match[4], 10)
            const text = match[5].trim()

            if (text) {  // Skip empty lines
                const time = minutes * 60 + seconds + centiseconds / 100
                lines.push({ time, text })
            }
        }
    }

    // Sort by time
    lines.sort((a, b) => a.time - b.time)

    return {
        synced: lines.length > 0,
        lines,
        format: 'lrc'
    }
}

/**
 * Parse SRT (SubRip) subtitle format
 * Format:
 * 1
 * 00:00:12,500 --> 00:00:16,300
 * First verse lyrics
 */
export function parseSRT(content: string): ParsedLyrics {
    const lines: LyricsLine[] = []
    const blocks = content.trim().split(/\n\s*\n/)  // Split by empty lines

    // SRT timestamp pattern: HH:MM:SS,mmm --> HH:MM:SS,mmm
    const timestampRegex = /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/

    for (const block of blocks) {
        const blockLines = block.split('\n')
        if (blockLines.length < 2) continue

        // Skip the sequence number (first line)
        // Find the timestamp line
        let timestampLine = ''
        let textStartIndex = 0

        for (let i = 0; i < blockLines.length; i++) {
            if (timestampRegex.test(blockLines[i])) {
                timestampLine = blockLines[i]
                textStartIndex = i + 1
                break
            }
        }

        if (!timestampLine) continue

        const match = timestampLine.match(timestampRegex)
        if (!match) continue

        // Parse start time
        const startHours = parseInt(match[1], 10)
        const startMinutes = parseInt(match[2], 10)
        const startSeconds = parseInt(match[3], 10)
        const startMillis = parseInt(match[4], 10)

        // Parse end time
        const endHours = parseInt(match[5], 10)
        const endMinutes = parseInt(match[6], 10)
        const endSeconds = parseInt(match[7], 10)
        const endMillis = parseInt(match[8], 10)

        const time = startHours * 3600 + startMinutes * 60 + startSeconds + startMillis / 1000
        const endTime = endHours * 3600 + endMinutes * 60 + endSeconds + endMillis / 1000

        // Combine remaining lines as text (may span multiple lines)
        const text = blockLines.slice(textStartIndex).join(' ').trim()

        if (text) {
            lines.push({ time, endTime, text })
        }
    }

    // Sort by time
    lines.sort((a, b) => a.time - b.time)

    return {
        synced: lines.length > 0,
        lines,
        format: 'srt'
    }
}

/**
 * Parse TTML (Timed Text Markup Language) format - Apple Music style
 * This is XML-based format used by Apple Music for lyrics
 * Supports word-by-word timing from syllable-lyrics (itunes:timing="Word")
 */
export function parseTTML(content: string): ParsedLyrics {
    const lines: LyricsLine[] = []

    // Check if this is word-level timed TTML (syllable-lyrics)
    const hasWordTiming = content.includes('itunes:timing="Word"') ||
        content.includes("itunes:timing='Word'")

    // Parse TTML timestamps - supports various formats:
    // begin="00:00:12.500" end="00:00:16.300"
    // or with word-level timing using <span> elements

    // Extract all <p> elements with their full content (including nested elements)
    // Also capture the full tag attributes to extract ttm:agent
    const pRegex = /<p([^>]*)begin=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/p>/gi

    let match
    while ((match = pRegex.exec(content)) !== null) {
        const attrsBefore = match[1]
        const beginStr = match[2]
        const attrsAfter = match[3]
        const innerContent = match[4]
        const fullAttrs = attrsBefore + attrsAfter

        const time = parseTTMLTimestamp(beginStr)

        // Extract end time
        const endMatch = fullAttrs.match(/end=["']([^"']+)["']/)
        const endTime = endMatch ? parseTTMLTimestamp(endMatch[1]) ?? undefined : undefined

        // Extract ttm:agent for singer identification
        const agentMatch = fullAttrs.match(/ttm:agent=["']([^"']+)["']/)
        const agent = agentMatch ? agentMatch[1] : undefined

        if (time === null) continue

        // Extract word-level timing from <span> elements if present
        // Need to also detect spaces BETWEEN spans, not just inside them

        // First, get all span matches with their positions
        const spanRegex = /<span([^>]*)>([^<]*)<\/span>/gi
        const spanMatches: Array<{
            attrs: string
            text: string
            start: number
            end: number
        }> = []

        let spanMatch
        while ((spanMatch = spanRegex.exec(innerContent)) !== null) {
            spanMatches.push({
                attrs: spanMatch[1],
                text: spanMatch[2],
                start: spanMatch.index,
                end: spanMatch.index + spanMatch[0].length
            })
        }

        // Now process matches and detect word boundaries by checking content between spans
        const words: LyricsWord[] = []
        let i = 0

        while (i < spanMatches.length) {
            const currentSpan = spanMatches[i]

            // Extract timing from this span
            const beginMatch = currentSpan.attrs.match(/begin=["']([^"']+)["']/)
            const endMatch = currentSpan.attrs.match(/end=["']([^"']+)["']/)

            if (!beginMatch) {
                i++
                continue
            }

            const startTime = parseTTMLTimestamp(beginMatch[1])
            if (startTime === null) {
                i++
                continue
            }

            // Collect connected syllables (no whitespace between them)
            const connectedSyllables: LyricsSyllable[] = [{
                time: startTime,
                endTime: endMatch ? parseTTMLTimestamp(endMatch[1]) ?? undefined : undefined,
                text: currentSpan.text
            }]

            // Look ahead for connected syllables
            let j = i + 1
            while (j < spanMatches.length) {
                const prevSpan = spanMatches[j - 1]
                const nextSpan = spanMatches[j]

                // Check what's between the end of prev span and start of next span
                const betweenContent = innerContent.substring(prevSpan.end, nextSpan.start)

                // If there's whitespace or other non-tag content between, it's a word break
                const hasWordBreak = /\s/.test(betweenContent) ||
                    (betweenContent.length > 0 && !betweenContent.startsWith('<'))

                if (hasWordBreak) break

                // Extract timing for this syllable
                const nextBeginMatch = nextSpan.attrs.match(/begin=["']([^"']+)["']/)
                const nextEndMatch = nextSpan.attrs.match(/end=["']([^"']+)["']/)

                if (nextBeginMatch) {
                    const nextTime = parseTTMLTimestamp(nextBeginMatch[1])
                    if (nextTime !== null) {
                        connectedSyllables.push({
                            time: nextTime,
                            endTime: nextEndMatch ? parseTTMLTimestamp(nextEndMatch[1]) ?? undefined : undefined,
                            text: nextSpan.text
                        })
                    }
                }
                j++
            }

            // Create the word from connected syllables
            const wordText = connectedSyllables.map(s => s.text).join('')
            const wordTime = connectedSyllables[0].time
            const lastSyllable = connectedSyllables[connectedSyllables.length - 1]
            const wordEndTime = lastSyllable.endTime

            if (wordText.trim()) {
                const word: LyricsWord = {
                    time: wordTime,
                    endTime: wordEndTime,
                    text: wordText
                }

                // Only add syllables array if there are multiple syllables
                if (connectedSyllables.length > 1) {
                    word.syllables = connectedSyllables
                }

                words.push(word)
            }

            i = j
        }

        // Get full line text, stripping XML tags
        const text = innerContent
            .replace(/<[^>]+>/g, '')  // Remove XML tags
            .replace(/\s+/g, ' ')      // Normalize whitespace
            .trim()

        if (!text) continue

        const line: LyricsLine = { time, endTime, text, agent }
        if (words.length > 0) {
            line.words = words
        }
        lines.push(line)
    }

    // If no <p> elements found, try standalone <span> elements (rare case)
    if (lines.length === 0) {
        const spanRegex = /<span[^>]*begin=["']([^"']+)["'][^>]*(?:end=["']([^"']+)["'])?[^>]*>([^<]*)<\/span>/gi

        while ((match = spanRegex.exec(content)) !== null) {
            const beginStr = match[1]
            const endStr = match[2]
            const text = match[3].trim()

            if (!text) continue

            const time = parseTTMLTimestamp(beginStr)
            const endTime = endStr ? parseTTMLTimestamp(endStr) ?? undefined : undefined

            if (time !== null) {
                lines.push({ time, endTime, text })
            }
        }
    }

    // Sort by time
    lines.sort((a, b) => a.time - b.time)

    // Parse translations section
    // Format: <translations><translation type="subtitle" xml:lang="en-US"><text for="L##">...</text></translation></translations>
    let hasTranslation = false
    let translationLanguage: string | undefined

    const translationsMatch = content.match(/<translations>([\s\S]*?)<\/translations>/)
    if (translationsMatch) {
        const translationsContent = translationsMatch[1]

        // Get translation language
        const langMatch = translationsContent.match(/<translation[^>]*xml:lang="([^"]+)"/)
        if (langMatch) {
            translationLanguage = langMatch[1]
        }

        // Extract all translation texts
        const textRegex = /<text\s+for="([^"]+)"[^>]*>([^<]+)<\/text>/g
        let textMatch
        while ((textMatch = textRegex.exec(translationsContent)) !== null) {
            const lineKey = textMatch[1] // e.g., "L61"
            const translatedText = textMatch[2].trim()

            // Find the corresponding line by itunes:key
            // We need to search the original content for the line with this key
            const lineKeyPattern = new RegExp(`<p[^>]*itunes:key="${lineKey}"[^>]*>`)
            const lineWithKey = lines.find((line, index) => {
                // Match by position - line keys are typically L1, L2, etc.
                const keyNum = parseInt(lineKey.replace('L', ''), 10)
                return index === keyNum - 1
            })

            if (lineWithKey) {
                lineWithKey.translation = translatedText
                hasTranslation = true
            }
        }
    }

    // Parse transliterations section
    // Format: <transliterations><transliteration xml:lang="ko-Latn"><text for="L##"><span>...</span></text></transliteration></transliterations>
    let hasTransliteration = false
    let transliterationLanguage: string | undefined

    const transliterationsMatch = content.match(/<transliterations>([\s\S]*?)<\/transliterations>/)
    if (transliterationsMatch) {
        const transliterationsContent = transliterationsMatch[1]

        // Get transliteration language
        const langMatch = transliterationsContent.match(/<transliteration[^>]*xml:lang="([^"]+)"/)
        if (langMatch) {
            transliterationLanguage = langMatch[1]
        }

        // Extract all transliteration texts with their spans
        // Format: <text for="L##"><span begin="..." end="...">romanized text</span>...</text>
        const textRegex = /<text\s+for="([^"]+)"[^>]*>([\s\S]*?)<\/text>/g
        let textMatch
        while ((textMatch = textRegex.exec(transliterationsContent)) !== null) {
            const lineKey = textMatch[1]
            const spansContent = textMatch[2]

            // Find the corresponding line
            const keyNum = parseInt(lineKey.replace('L', ''), 10)
            const lineIndex = keyNum - 1
            const line = lines[lineIndex]

            if (line && line.words) {
                // Parse spans with timing
                const spanRegex = /<span[^>]*begin="([^"]+)"[^>]*end="([^"]+)"[^>]*>([^<]+)<\/span>/g
                let spanMatch
                const translitSpans: { time: number; endTime: number; text: string }[] = []

                while ((spanMatch = spanRegex.exec(spansContent)) !== null) {
                    const time = parseTTMLTimestamp(spanMatch[1])
                    const endTime = parseTTMLTimestamp(spanMatch[2])
                    const text = spanMatch[3].trim()

                    if (time !== null && endTime !== null) {
                        translitSpans.push({ time, endTime, text })
                    }
                }

                // Match transliteration spans to words by timing
                for (const word of line.words) {
                    // Find transliteration span that matches this word's timing
                    const matchingSpan = translitSpans.find(span =>
                        Math.abs(span.time - word.time) < 0.1 // Allow 100ms tolerance
                    )
                    if (matchingSpan) {
                        word.transliteration = matchingSpan.text
                        hasTransliteration = true
                    }
                }
            }
        }
    }

    // Parse songwriters from metadata
    // Format: <songwriters><songwriter>Name</songwriter>...</songwriters>
    const songwriters: string[] = []
    const songwritersMatch = content.match(/<songwriters>([\s\S]*?)<\/songwriters>/)
    if (songwritersMatch) {
        const songwriterRegex = /<songwriter>([^<]+)<\/songwriter>/g
        let swMatch
        while ((swMatch = songwriterRegex.exec(songwritersMatch[1])) !== null) {
            songwriters.push(swMatch[1].trim())
        }
    }

    return {
        synced: lines.length > 0,
        lines,
        format: 'ttml',
        hasWordTiming: hasWordTiming && lines.some(l => l.words && l.words.length > 0),
        hasTranslation,
        hasTransliteration,
        translationLanguage,
        transliterationLanguage,
        songwriters: songwriters.length > 0 ? songwriters : undefined
    }
}

/**
 * Parse TTML timestamp formats
 * Supports: HH:MM:SS.mmm, MM:SS.mmm, SS.mmm, or seconds as decimal
 */
function parseTTMLTimestamp(timestamp: string): number | null {
    if (!timestamp) return null

    // Handle pure seconds format (e.g., "12.500s" or "12.5")
    const secondsMatch = timestamp.match(/^(\d+(?:\.\d+)?)s?$/)
    if (secondsMatch) {
        return parseFloat(secondsMatch[1])
    }

    // Handle HH:MM:SS.mmm or MM:SS.mmm
    const timeMatch = timestamp.match(/(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)/)
    if (timeMatch) {
        const hours = timeMatch[1] ? parseInt(timeMatch[1], 10) : 0
        const minutes = parseInt(timeMatch[2], 10)
        const seconds = parseFloat(timeMatch[3])
        return hours * 3600 + minutes * 60 + seconds
    }

    return null
}

/**
 * Parse plain text lyrics (no timing, just line breaks)
 */
export function parsePlainLyrics(content: string): ParsedLyrics {
    const lines: LyricsLine[] = content
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .map((text, index) => ({
            time: index,  // Use line index as pseudo-time
            text
        }))

    return {
        synced: false,
        lines,
        format: 'plain'
    }
}

/**
 * Detect format and parse lyrics file content
 */
export function parseLyrics(content: string, filePath?: string): ParsedLyrics {
    // Detect format by file extension if provided
    if (filePath) {
        const ext = filePath.toLowerCase().split('.').pop()
        switch (ext) {
            case 'lrc':
                return parseLRC(content)
            case 'srt':
                return parseSRT(content)
            case 'ttml':
            case 'xml':
                return parseTTML(content)
        }
    }

    // Auto-detect format by content
    const trimmed = content.trim()

    // TTML detection: starts with XML declaration or contains <tt> tag
    if (trimmed.startsWith('<?xml') || trimmed.includes('<tt') || trimmed.includes('<body>')) {
        return parseTTML(content)
    }

    // SRT detection: starts with a number followed by timestamp line
    if (/^\d+\s*\n\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->/.test(trimmed)) {
        return parseSRT(content)
    }

    // LRC detection: starts with [MM:SS.xx] pattern
    if (/^\[\d{2}:\d{2}[.:]\d{2}\]/.test(trimmed)) {
        return parseLRC(content)
    }

    // Default to plain text
    return parsePlainLyrics(content)
}

/**
 * Merge translations and transliterations from a secondary file into the main lyrics
 * Used when translations are stored in separate files (e.g., track.en.ttml)
 */
export function mergeTranslations(main: ParsedLyrics, translation: ParsedLyrics): ParsedLyrics {
    // Clone main to avoid mutation
    const merged: ParsedLyrics = {
        ...main,
        lines: main.lines.map(line => ({ ...line, words: line.words?.map(w => ({ ...w })) }))
    }

    // Merge translations from secondary file
    for (let i = 0; i < translation.lines.length && i < merged.lines.length; i++) {
        const transLine = translation.lines[i]
        const mainLine = merged.lines[i]

        // Copy translation if available
        if (transLine.translation && !mainLine.translation) {
            mainLine.translation = transLine.translation
        }

        // Copy transliterations to words if available
        if (transLine.words && mainLine.words) {
            for (let j = 0; j < transLine.words.length && j < mainLine.words.length; j++) {
                if (transLine.words[j].transliteration && !mainLine.words[j].transliteration) {
                    mainLine.words[j].transliteration = transLine.words[j].transliteration
                }
            }
        }
    }

    // Update flags
    if (translation.hasTranslation) {
        merged.hasTranslation = true
        merged.translationLanguage = merged.translationLanguage || translation.translationLanguage
    }
    if (translation.hasTransliteration) {
        merged.hasTransliteration = true
        merged.transliterationLanguage = merged.transliterationLanguage || translation.transliterationLanguage
    }

    return merged
}
