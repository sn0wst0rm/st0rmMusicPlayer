import { NextResponse } from 'next/server';
import db from '@/lib/db';

interface RouteParams {
    params: Promise<{ id: string }>;
}

// GET single playlist with all tracks
export async function GET(request: Request, { params }: RouteParams) {
    const { id } = await params;

    const playlist = await db.playlist.findUnique({
        where: { id },
        include: {
            tracks: {
                include: {
                    track: {
                        include: {
                            artist: true,
                            album: true
                        }
                    }
                },
                orderBy: { position: 'asc' }
            }
        }
    });

    if (!playlist) {
        return NextResponse.json(
            { error: 'Playlist not found' },
            { status: 404 }
        );
    }

    return NextResponse.json({
        id: playlist.id,
        name: playlist.name,
        description: playlist.description,
        coverPath: playlist.coverPath,
        isSynced: playlist.isSynced,
        appleMusicId: playlist.appleMusicId,
        artworkUrl: playlist.artworkUrl,
        createdAt: playlist.createdAt,
        updatedAt: playlist.updatedAt,
        trackCount: playlist.tracks.length,
        tracks: playlist.tracks.map(pt => ({
            id: pt.id,
            position: pt.position,
            addedAt: pt.addedAt,
            track: {
                id: pt.track.id,
                title: pt.track.title,
                artistId: pt.track.artistId,
                albumId: pt.track.albumId,
                filePath: pt.track.filePath,
                duration: pt.track.duration,
                trackNumber: pt.track.trackNumber,
                artist: pt.track.artist,
                album: pt.track.album
            }
        }))
    });
}

// PUT update playlist name/description
export async function PUT(request: Request, { params }: RouteParams) {
    const { id } = await params;

    try {
        // Check if playlist is synced (read-only)
        const existingPlaylist = await db.playlist.findUnique({
            where: { id },
            select: { isSynced: true }
        });

        if (existingPlaylist?.isSynced) {
            return NextResponse.json(
                { error: 'Cannot edit a synced playlist. It is managed by Apple Music.' },
                { status: 403 }
            );
        }

        const body = await request.json();
        const { name, description, coverPath } = body;

        const updateData: { name?: string; description?: string | null; coverPath?: string | null } = {};

        if (name !== undefined) {
            if (typeof name !== 'string' || name.trim() === '') {
                return NextResponse.json(
                    { error: 'Playlist name cannot be empty' },
                    { status: 400 }
                );
            }
            updateData.name = name.trim();
        }

        if (description !== undefined) {
            updateData.description = description?.trim() || null;
        }

        if (coverPath !== undefined) {
            updateData.coverPath = coverPath || null;
        }

        const playlist = await db.playlist.update({
            where: { id },
            data: updateData
        });

        return NextResponse.json({
            id: playlist.id,
            name: playlist.name,
            description: playlist.description,
            coverPath: playlist.coverPath
        });
    } catch (error) {
        console.error('Error updating playlist:', error);
        return NextResponse.json(
            { error: 'Failed to update playlist' },
            { status: 500 }
        );
    }
}

// DELETE playlist
export async function DELETE(request: Request, { params }: RouteParams) {
    const { id } = await params;

    try {
        // Check if playlist exists
        const existingPlaylist = await db.playlist.findUnique({
            where: { id },
            select: { isSynced: true }
        });

        if (!existingPlaylist) {
            return NextResponse.json(
                { error: 'Playlist not found' },
                { status: 404 }
            );
        }

        await db.playlist.delete({
            where: { id }
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error deleting playlist:', error);
        return NextResponse.json(
            { error: 'Failed to delete playlist' },
            { status: 500 }
        );
    }
}
