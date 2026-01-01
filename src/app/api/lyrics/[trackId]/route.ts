import { NextResponse } from 'next/server'
import db from '@/lib/db'
import { parseLyrics, mergeTranslations } from '@/lib/lyrics-parser'
import * as fs from 'fs/promises'
import * as path from 'path'

interface RouteParams {
    params: Promise<{ trackId: string }>
}

export async function GET(request: Request, { params }: RouteParams) {
    try {
        const { trackId } = await params

        // Get track from database
        const track = await db.track.findUnique({
            where: { id: trackId },
            select: {
                id: true,
                lyricsPath: true,
                lyrics: true,
                filePath: true
            }
        })

        if (!track) {
            return NextResponse.json(
                { error: 'Track not found' },
                { status: 404 }
            )
        }

        // Priority 1: Try to read synced lyrics file
        if (track.lyricsPath) {
            try {
                const content = await fs.readFile(track.lyricsPath, 'utf-8')
                let parsed = parseLyrics(content, track.lyricsPath)

                // Look for translation files (e.g., track.en.ttml, track.ja.ttml)
                // Pattern: {basename}.{lang}.{ext}
                if (track.lyricsPath.endsWith('.ttml')) {
                    const dir = path.dirname(track.lyricsPath)
                    const basename = path.basename(track.lyricsPath, '.ttml')

                    try {
                        const dirContents = await fs.readdir(dir)
                        // Find translation files: {basename}.{lang}.ttml
                        const translationFiles = dirContents.filter(file => {
                            const match = file.match(new RegExp(`^${basename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.([a-z]{2}(?:-[A-Z]{2})?)\\.ttml$`))
                            return match && file !== path.basename(track.lyricsPath!)
                        })

                        // Parse each translation file and merge
                        for (const transFile of translationFiles) {
                            const transPath = path.join(dir, transFile)
                            try {
                                const transContent = await fs.readFile(transPath, 'utf-8')
                                const transParsed = parseLyrics(transContent, transPath)

                                // Merge translations and transliterations into main lyrics
                                if (transParsed.hasTranslation || transParsed.hasTransliteration) {
                                    parsed = mergeTranslations(parsed, transParsed)
                                }
                            } catch {
                                // Skip if translation file can't be read
                            }
                        }
                    } catch {
                        // Directory read failed, continue without translations
                    }
                }

                return NextResponse.json(parsed)
            } catch {
                console.warn(`[lyrics] Could not read lyrics file: ${track.lyricsPath}`)
                // Fall through to try embedded lyrics
            }
        }

        // Priority 2: Try to find lyrics file next to audio file
        // Common patterns: same name with .lrc, .srt, or .ttml extension
        if (track.filePath) {
            const dir = path.dirname(track.filePath)
            const basename = path.basename(track.filePath, path.extname(track.filePath))

            for (const ext of ['.lrc', '.srt', '.ttml']) {
                const lyricsPath = path.join(dir, basename + ext)
                try {
                    const content = await fs.readFile(lyricsPath, 'utf-8')
                    const parsed = parseLyrics(content, lyricsPath)

                    // Update database with discovered lyrics path
                    await db.track.update({
                        where: { id: trackId },
                        data: { lyricsPath }
                    })

                    return NextResponse.json(parsed)
                } catch {
                    // File doesn't exist, try next extension
                }
            }
        }

        // Priority 3: Use embedded plain text lyrics
        if (track.lyrics) {
            const parsed = parseLyrics(track.lyrics)
            return NextResponse.json(parsed)
        }

        // No lyrics found
        return NextResponse.json({
            synced: false,
            lines: [],
            format: 'none',
            message: 'No lyrics available for this track'
        })

    } catch (error) {
        console.error('[lyrics] Error fetching lyrics:', error)
        return NextResponse.json(
            { error: 'Failed to fetch lyrics' },
            { status: 500 }
        )
    }
}
