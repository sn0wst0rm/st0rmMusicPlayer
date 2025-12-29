import { NextResponse } from 'next/server';
import db from '@/lib/db';

// GET all playlists with track count
export async function GET() {
    const playlists = await db.playlist.findMany({
        include: {
            tracks: {
                include: {
                    track: {
                        include: {
                            album: true
                        }
                    }
                },
                orderBy: { position: 'asc' },
                take: 4 // For mosaic cover art
            },
            _count: {
                select: { tracks: true }
            }
        },
        orderBy: { updatedAt: 'desc' }
    });

    // Transform to include track count at top level
    const result = playlists.map(playlist => ({
        id: playlist.id,
        name: playlist.name,
        description: playlist.description,
        coverPath: playlist.coverPath,
        artworkUrl: playlist.artworkUrl, // Apple Music artwork URL
        createdAt: playlist.createdAt,
        updatedAt: playlist.updatedAt,
        trackCount: playlist._count.tracks,
        // Include first 4 track covers for mosaic
        coverTracks: playlist.tracks.map(pt => ({
            id: pt.track.id,
            albumId: pt.track.albumId
        }))
    }));

    return NextResponse.json(result);
}

// POST create new playlist
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { name, description } = body;

        if (!name || typeof name !== 'string' || name.trim() === '') {
            return NextResponse.json(
                { error: 'Playlist name is required' },
                { status: 400 }
            );
        }

        const playlist = await db.playlist.create({
            data: {
                name: name.trim(),
                description: description?.trim() || null
            }
        });

        return NextResponse.json({
            id: playlist.id,
            name: playlist.name,
            description: playlist.description,
            coverPath: playlist.coverPath,
            trackCount: 0,
            coverTracks: []
        }, { status: 201 });
    } catch (error) {
        console.error('Error creating playlist:', error);
        return NextResponse.json(
            { error: 'Failed to create playlist' },
            { status: 500 }
        );
    }
}
