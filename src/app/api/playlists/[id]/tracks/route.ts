import { NextResponse } from 'next/server';
import db from '@/lib/db';

interface RouteParams {
    params: Promise<{ id: string }>;
}

// POST add track(s) to playlist
export async function POST(request: Request, { params }: RouteParams) {
    const { id: playlistId } = await params;

    try {
        // Check if playlist is synced (read-only)
        const playlist = await db.playlist.findUnique({
            where: { id: playlistId },
            select: { isSynced: true }
        });

        if (playlist?.isSynced) {
            return NextResponse.json(
                { error: 'Cannot modify a synced playlist. It is managed by Apple Music.' },
                { status: 403 }
            );
        }

        const body = await request.json();
        const { trackIds, force = false } = body;

        if (!trackIds || !Array.isArray(trackIds) || trackIds.length === 0) {
            return NextResponse.json(
                { error: 'trackIds array is required' },
                { status: 400 }
            );
        }

        // Get current max position
        const maxPosition = await db.playlistTrack.aggregate({
            where: { playlistId },
            _max: { position: true }
        });

        let nextPosition = (maxPosition._max.position ?? -1) + 1;

        let tracksToAdd = trackIds;

        // Only filter duplicates if force is not set
        if (!force) {
            // Filter out tracks already in playlist
            const existingTracks = await db.playlistTrack.findMany({
                where: {
                    playlistId,
                    trackId: { in: trackIds }
                },
                select: { trackId: true }
            });

            const existingTrackIds = new Set(existingTracks.map(t => t.trackId));
            tracksToAdd = trackIds.filter((id: string) => !existingTrackIds.has(id));

            if (tracksToAdd.length === 0) {
                return NextResponse.json({
                    message: 'All tracks are already in playlist',
                    added: 0,
                    playlistTrackIds: []
                });
            }
        }

        // Add tracks one by one to get their IDs
        const createdTracks = await Promise.all(
            tracksToAdd.map((trackId: string) =>
                db.playlistTrack.create({
                    data: {
                        playlistId,
                        trackId,
                        position: nextPosition++
                    }
                })
            )
        );

        const playlistTrackIds = createdTracks.map(t => t.id);

        return NextResponse.json({
            message: 'Tracks added successfully',
            added: tracksToAdd.length,
            playlistTrackIds
        }, { status: 201 });
    } catch (error) {
        console.error('Error adding tracks to playlist:', error);
        return NextResponse.json(
            { error: 'Failed to add tracks to playlist' },
            { status: 500 }
        );
    }
}

// DELETE remove track from playlist
export async function DELETE(request: Request, { params }: RouteParams) {
    const { id: playlistId } = await params;

    try {
        // Check if playlist is synced (read-only)
        const playlist = await db.playlist.findUnique({
            where: { id: playlistId },
            select: { isSynced: true }
        });

        if (playlist?.isSynced) {
            return NextResponse.json(
                { error: 'Cannot modify a synced playlist. It is managed by Apple Music.' },
                { status: 403 }
            );
        }

        const { searchParams } = new URL(request.url);
        const trackId = searchParams.get('trackId');
        const playlistTrackId = searchParams.get('playlistTrackId');

        if (!trackId && !playlistTrackId) {
            return NextResponse.json(
                { error: 'trackId or playlistTrackId is required' },
                { status: 400 }
            );
        }

        if (playlistTrackId) {
            // Delete by playlist track ID (more precise for duplicates)
            await db.playlistTrack.delete({
                where: { id: playlistTrackId }
            });
        } else if (trackId) {
            // Delete by track ID
            await db.playlistTrack.deleteMany({
                where: { playlistId, trackId }
            });
        }

        // Reorder remaining tracks to fill gaps
        const remainingTracks = await db.playlistTrack.findMany({
            where: { playlistId },
            orderBy: { position: 'asc' }
        });

        // Update positions to be sequential
        await Promise.all(
            remainingTracks.map((track, index) =>
                db.playlistTrack.update({
                    where: { id: track.id },
                    data: { position: index }
                })
            )
        );

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error removing track from playlist:', error);
        return NextResponse.json(
            { error: 'Failed to remove track from playlist' },
            { status: 500 }
        );
    }
}

// PUT reorder tracks in playlist
export async function PUT(request: Request, { params }: RouteParams) {
    const { id: playlistId } = await params;

    try {
        // Check if playlist is synced (read-only)
        const playlist = await db.playlist.findUnique({
            where: { id: playlistId },
            select: { isSynced: true }
        });

        if (playlist?.isSynced) {
            return NextResponse.json(
                { error: 'Cannot modify a synced playlist. It is managed by Apple Music.' },
                { status: 403 }
            );
        }

        const body = await request.json();
        const { orderedTrackIds } = body;

        if (!orderedTrackIds || !Array.isArray(orderedTrackIds)) {
            return NextResponse.json(
                { error: 'orderedTrackIds array is required' },
                { status: 400 }
            );
        }

        // Update all positions in a transaction
        await db.$transaction(
            orderedTrackIds.map((playlistTrackId: string, index: number) =>
                db.playlistTrack.update({
                    where: { id: playlistTrackId },
                    data: { position: index }
                })
            )
        );

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error reordering playlist tracks:', error);
        return NextResponse.json(
            { error: 'Failed to reorder tracks' },
            { status: 500 }
        );
    }
}
