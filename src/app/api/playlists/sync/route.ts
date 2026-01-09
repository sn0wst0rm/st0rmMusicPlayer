import { NextResponse } from 'next/server';
import db from '@/lib/db';

const GAMDL_SERVICE_URL = process.env.GAMDL_SERVICE_URL || 'http://127.0.0.1:5100';

interface RemoteTrack {
    position: number;
    appleMusicId: string;
    title: string;
    artistName: string;
    albumName: string;
    durationMs?: number;
}

interface SyncResult {
    playlistId: string;
    addedTracks: number;
    removedTracks: number;
    totalTracks: number;
    lastModifiedDate?: string;
}

// POST - Sync a specific playlist
export async function POST(request: Request) {
    try {
        const { playlistId } = await request.json();

        if (!playlistId) {
            return NextResponse.json({ error: 'Playlist ID is required' }, { status: 400 });
        }

        // Get the playlist with its tracks
        const playlist = await db.playlist.findUnique({
            where: { id: playlistId },
            include: {
                tracks: {
                    include: {
                        track: true
                    },
                    orderBy: { position: 'asc' }
                }
            }
        });

        if (!playlist) {
            return NextResponse.json({ error: 'Playlist not found' }, { status: 404 });
        }

        if (!playlist.isSynced) {
            return NextResponse.json({ error: 'Playlist is not synced' }, { status: 400 });
        }

        // Get cookies for Apple Music API
        const settings = await db.gamdlSettings.findUnique({
            where: { id: 'singleton' }
        });

        if (!settings?.cookies) {
            return NextResponse.json({ error: 'No Apple Music cookies configured' }, { status: 400 });
        }

        // Fetch remote tracks from Apple Music via gamdl service
        const fetchId = playlist.globalId || playlist.appleMusicId;
        if (!fetchId) {
            return NextResponse.json({ error: 'No Apple Music ID for playlist' }, { status: 400 });
        }

        // Use HTTP for now (WebSocket integration can be added later)
        const response = await fetch(`${GAMDL_SERVICE_URL}/playlist-tracks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                appleMusicId: playlist.appleMusicId,
                globalId: playlist.globalId,
                cookies: settings.cookies
            })
        });

        if (!response.ok) {
            // Fallback: try using the sync endpoint
            const syncResponse = await fetch(`${GAMDL_SERVICE_URL}/check-playlist-sync`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    appleMusicId: playlist.appleMusicId,
                    globalId: playlist.globalId,
                    cookies: settings.cookies
                })
            });

            if (!syncResponse.ok) {
                return NextResponse.json({ error: 'Failed to fetch playlist from Apple Music' }, { status: 500 });
            }
        }

        const remoteData = await response.json();
        const remoteTracks: RemoteTrack[] = remoteData.tracks || [];

        // Get local track Apple Music IDs
        const localTrackIds = new Set(
            playlist.tracks
                .map(pt => pt.track.appleMusicId)
                .filter((id): id is string => id !== null)
        );

        // Find tracks to add (in remote but not in local)
        const remoteTrakIds = new Set(remoteTracks.map(t => t.appleMusicId));
        const tracksToAdd = remoteTracks.filter(t => !localTrackIds.has(t.appleMusicId));

        // Find tracks to remove (in local but not in remote)
        const tracksToRemove = playlist.tracks.filter(
            pt => pt.track.appleMusicId && !remoteTrakIds.has(pt.track.appleMusicId)
        );

        let addedCount = 0;
        let removedCount = 0;

        // Remove tracks from playlist (but NOT from library)
        if (tracksToRemove.length > 0) {
            await db.playlistTrack.deleteMany({
                where: {
                    playlistId: playlistId,
                    trackId: { in: tracksToRemove.map(pt => pt.trackId) }
                }
            });
            removedCount = tracksToRemove.length;
            console.log(`[SYNC] Removed ${removedCount} tracks from playlist ${playlist.name}`);
        }

        // Add missing tracks - download them if needed
        if (tracksToAdd.length > 0) {
            console.log(`[SYNC] Need to add ${tracksToAdd.length} tracks to playlist ${playlist.name}`);

            for (const remoteTrack of tracksToAdd) {
                // Check if track already exists in library by Apple Music ID
                const existingTrack = await db.track.findFirst({
                    where: { appleMusicId: remoteTrack.appleMusicId }
                });

                if (existingTrack) {
                    // Track exists in library, just add to playlist
                    const maxPosition = await db.playlistTrack.aggregate({
                        where: { playlistId },
                        _max: { position: true }
                    });

                    await db.playlistTrack.create({
                        data: {
                            playlistId,
                            trackId: existingTrack.id,
                            position: (maxPosition._max.position || 0) + 1
                        }
                    });
                    addedCount++;
                    console.log(`[SYNC] Added existing track "${remoteTrack.title}" to playlist`);
                } else {
                    // Track needs to be downloaded - queue it for download
                    // For now, just log - full download integration would be complex
                    console.log(`[SYNC] Track "${remoteTrack.title}" needs download (not in library)`);
                    // TODO: Trigger download via gamdl service
                }
            }
        }

        // Update playlist's lastSyncedAt and appleLastModifiedDate
        await db.playlist.update({
            where: { id: playlistId },
            data: {
                lastSyncedAt: new Date(),
                appleLastModifiedDate: remoteData.lastModifiedDate || new Date().toISOString()
            }
        });

        // Reorder tracks according to remote order
        const updatedPlaylist = await db.playlist.findUnique({
            where: { id: playlistId },
            include: {
                tracks: {
                    include: { track: true }
                }
            }
        });

        if (updatedPlaylist) {
            // Build a map of appleMusicId to position from remote
            const remotePositions = new Map(
                remoteTracks.map(t => [t.appleMusicId, t.position])
            );

            // Update positions
            for (const pt of updatedPlaylist.tracks) {
                if (pt.track.appleMusicId && remotePositions.has(pt.track.appleMusicId)) {
                    const newPosition = remotePositions.get(pt.track.appleMusicId)!;
                    if (pt.position !== newPosition) {
                        await db.playlistTrack.update({
                            where: { id: pt.id },
                            data: { position: newPosition }
                        });
                    }
                }
            }
        }

        const result: SyncResult = {
            playlistId,
            addedTracks: addedCount,
            removedTracks: removedCount,
            totalTracks: remoteTracks.length,
            lastModifiedDate: remoteData.lastModifiedDate
        };

        return NextResponse.json(result);

    } catch (error) {
        console.error('[SYNC ERROR]', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Sync failed' },
            { status: 500 }
        );
    }
}
