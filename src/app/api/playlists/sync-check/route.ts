import { NextResponse } from 'next/server';
import db from '@/lib/db';

const GAMDL_SERVICE_URL = process.env.GAMDL_SERVICE_URL || 'http://127.0.0.1:5100';

interface SyncCheckResult {
    playlistId: string;
    needsSync: boolean;
    message: string;
    appleLastModified?: string;
}

// POST - Check if playlists need syncing
// Body: { playlistIds?: string[] } - optional, if not provided checks all synced playlists
export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => ({}));
        const { playlistIds } = body as { playlistIds?: string[] };

        // Get settings for cookies
        const settings = await db.gamdlSettings.findUnique({
            where: { id: 'singleton' }
        });

        if (!settings?.cookies) {
            return NextResponse.json({
                error: 'No cookies configured. Please set up Apple Music credentials in settings.'
            }, { status: 400 });
        }

        // Get playlists to check
        let playlists;
        if (playlistIds && playlistIds.length > 0) {
            playlists = await db.playlist.findMany({
                where: {
                    id: { in: playlistIds },
                    isSynced: true,
                    appleMusicId: { not: null }
                },
                select: {
                    id: true,
                    name: true,
                    appleMusicId: true,
                    appleLastModifiedDate: true
                }
            });
        } else {
            // Check all synced playlists
            playlists = await db.playlist.findMany({
                where: {
                    isSynced: true,
                    appleMusicId: { not: null }
                },
                select: {
                    id: true,
                    name: true,
                    appleMusicId: true,
                    appleLastModifiedDate: true
                }
            });
        }

        if (playlists.length === 0) {
            return NextResponse.json({
                message: 'No synced playlists to check',
                results: []
            });
        }

        // Check each playlist
        const results: SyncCheckResult[] = [];

        for (const playlist of playlists) {
            try {
                const response = await fetch(`${GAMDL_SERVICE_URL}/check-playlist-sync`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        playlist_id: playlist.appleMusicId,
                        cookies: settings.cookies,
                        local_last_modified: playlist.appleLastModifiedDate?.toISOString() || null
                    })
                });

                if (response.ok) {
                    const data = await response.json();
                    results.push({
                        playlistId: playlist.id,
                        needsSync: data.needs_sync,
                        message: data.message,
                        appleLastModified: data.apple_last_modified
                    });
                } else {
                    results.push({
                        playlistId: playlist.id,
                        needsSync: false,
                        message: `Failed to check: ${response.statusText}`
                    });
                }
            } catch (error) {
                results.push({
                    playlistId: playlist.id,
                    needsSync: false,
                    message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
                });
            }
        }

        // Return which playlists need syncing
        const needsSync = results.filter(r => r.needsSync);

        return NextResponse.json({
            checkedCount: playlists.length,
            needsSyncCount: needsSync.length,
            results,
            playlistsNeedingSync: needsSync.map(r => r.playlistId)
        });

    } catch (error) {
        console.error('Error checking playlist sync:', error);
        return NextResponse.json(
            { error: 'Failed to check playlist sync status' },
            { status: 500 }
        );
    }
}
