/**
 * Lyrics parsing utilities for LRC, SRT, and TTML formats
 * Used by Apple Music-style lyrics to support gamdl downloaded files
 * Supports word-by-word timing from Apple Music syllable-lyrics
 */

export interface LyricsWord {
    time: number     // Start time in seconds
    endTime?: number // End time in seconds
    text: string     // The word text
}

export interface LyricsLine {
    time: number    // Start time in seconds
    endTime?: number // End time in seconds (optional, for SRT/TTML)
    text: string
    words?: LyricsWord[] // Word-level timing (optional, for syllable-lyrics)
}

export interface ParsedLyrics {
    synced: boolean
    lines: LyricsLine[]
    format: 'lrc' | 'srt' | 'ttml' | 'plain'
    hasWordTiming?: boolean // True if word-by-word timing is available
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
    const pRegex = /<p[^>]*begin=["']([^"']+)["'][^>]*(?:end=["']([^"']+)["'])?[^>]*>([\s\S]*?)<\/p>/gi

    let match
    while ((match = pRegex.exec(content)) !== null) {
        const beginStr = match[1]
        const endStr = match[2]
        const innerContent = match[3]

        const time = parseTTMLTimestamp(beginStr)
        const endTime = endStr ? parseTTMLTimestamp(endStr) ?? undefined : undefined

        if (time === null) continue

        // Extract word-level timing from <span> elements if present
        const words: LyricsWord[] = []
        const spanRegex = /<span[^>]*begin=["']([^"']+)["'][^>]*(?:end=["']([^"']+)["'])?[^>]*>([^<]*)<\/span>/gi

        let spanMatch
        while ((spanMatch = spanRegex.exec(innerContent)) !== null) {
            const wordBegin = spanMatch[1]
            const wordEnd = spanMatch[2]
            const wordText = spanMatch[3].trim()

            if (!wordText) continue

            const wordTime = parseTTMLTimestamp(wordBegin)
            const wordEndTime = wordEnd ? parseTTMLTimestamp(wordEnd) ?? undefined : undefined

            if (wordTime !== null) {
                words.push({
                    time: wordTime,
                    endTime: wordEndTime,
                    text: wordText
                })
            }
        }

        // Get full line text, stripping XML tags
        const text = innerContent
            .replace(/<[^>]+>/g, '')  // Remove XML tags
            .replace(/\s+/g, ' ')      // Normalize whitespace
            .trim()

        if (!text) continue

        const line: LyricsLine = { time, endTime, text }
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

    return {
        synced: lines.length > 0,
        lines,
        format: 'ttml',
        hasWordTiming: hasWordTiming && lines.some(l => l.words && l.words.length > 0)
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
