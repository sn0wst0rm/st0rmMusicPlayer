import { NextResponse } from 'next/server';
import db from '@/lib/db';

const GAMDL_SERVICE_URL = process.env.GAMDL_SERVICE_URL || 'http://127.0.0.1:5100';

// GET current gamdl settings
export async function GET() {
    try {
        // Get or create singleton settings
        let settings = await db.gamdlSettings.findUnique({
            where: { id: 'singleton' }
        });

        if (!settings) {
            settings = await db.gamdlSettings.create({
                data: { id: 'singleton' }
            });
        }

        // Check if Python service is online
        let serviceOnline = false;
        try {
            const healthRes = await fetch(`${GAMDL_SERVICE_URL}/health`, {
                signal: AbortSignal.timeout(2000)
            });
            serviceOnline = healthRes.ok;
        } catch {
            serviceOnline = false;
        }

        return NextResponse.json({
            ...settings,
            // Mask cookies for security (only show if set or not)
            cookiesConfigured: !!settings.cookies,
            cookies: undefined, // Never send cookies to client
            serviceOnline
        });
    } catch (error) {
        console.error('Error fetching gamdl settings:', error);
        return NextResponse.json(
            { error: 'Failed to fetch settings' },
            { status: 500 }
        );
    }
}

// PUT update gamdl settings
export async function PUT(request: Request) {
    try {
        const body = await request.json();
        const {
            cookies,
            mediaLibraryPath,
            songCodecs,
            lyricsFormat,
            coverSize,
            saveCover,
            language,
            overwrite,
            syncEnabled,
            syncInterval,
            autoSyncOnChange,
            lyricsTranslationLangs,
            lyricsPronunciationLangs
        } = body;

        // Build update data - only include fields that were provided
        const updateData: Record<string, unknown> = {};

        if (cookies !== undefined) updateData.cookies = cookies;
        if (mediaLibraryPath !== undefined) updateData.mediaLibraryPath = mediaLibraryPath;
        if (songCodecs !== undefined) updateData.songCodecs = songCodecs;
        if (lyricsFormat !== undefined) updateData.lyricsFormat = lyricsFormat;
        if (coverSize !== undefined) updateData.coverSize = coverSize;
        if (saveCover !== undefined) updateData.saveCover = saveCover;
        if (language !== undefined) updateData.language = language;
        if (overwrite !== undefined) updateData.overwrite = overwrite;
        if (syncEnabled !== undefined) updateData.syncEnabled = syncEnabled;
        if (syncInterval !== undefined) updateData.syncInterval = syncInterval;
        if (autoSyncOnChange !== undefined) updateData.autoSyncOnChange = autoSyncOnChange;
        if (lyricsTranslationLangs !== undefined) updateData.lyricsTranslationLangs = lyricsTranslationLangs;
        if (lyricsPronunciationLangs !== undefined) updateData.lyricsPronunciationLangs = lyricsPronunciationLangs;

        const settings = await db.gamdlSettings.upsert({
            where: { id: 'singleton' },
            create: {
                id: 'singleton',
                ...updateData
            },
            update: updateData
        });

        // Reconfigure the Python service scheduler if sync settings changed
        if (syncEnabled !== undefined || syncInterval !== undefined) {
            try {
                await fetch(`${GAMDL_SERVICE_URL}/reconfigure-scheduler`, {
                    method: 'POST',
                    signal: AbortSignal.timeout(5000)
                });
            } catch (e) {
                console.warn('Failed to reconfigure scheduler:', e);
            }
        }

        return NextResponse.json({
            ...settings,
            cookiesConfigured: !!settings.cookies,
            cookies: undefined // Never send cookies to client
        });
    } catch (error) {
        console.error('Error updating gamdl settings:', error);
        return NextResponse.json(
            { error: 'Failed to update settings' },
            { status: 500 }
        );
    }
}
