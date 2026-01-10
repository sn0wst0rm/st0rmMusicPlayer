import { NextResponse } from 'next/server';
import db from '@/lib/db';

const GAMDL_SERVICE_URL = process.env.GAMDL_SERVICE_URL || 'http://127.0.0.1:5100';

export interface ArtistAlbumItem {
    apple_music_id: string;
    title: string;
    artwork_url?: string;
    release_date?: string;
    track_count?: number;
    is_single: boolean;
}

export interface ArtistResponse {
    apple_music_id: string;
    name: string;
    artwork_url?: string;
    bio?: string;
    genre?: string;
    origin?: string;
    birth_date?: string;
    url?: string;
    albums: ArtistAlbumItem[];
    singles: ArtistAlbumItem[];
    storefront: string;
}

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: artistId } = await params;

        // Get cookies from settings
        const settings = await db.gamdlSettings.findUnique({
            where: { id: 'singleton' }
        });

        if (!settings?.cookies) {
            return NextResponse.json(
                { error: 'Apple Music cookies not configured' },
                { status: 400 }
            );
        }

        const response = await fetch(`${GAMDL_SERVICE_URL}/artist`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                artist_id: artistId,
                cookies: settings.cookies
            }),
            signal: AbortSignal.timeout(30000)
        });

        if (!response.ok) {
            const error = await response.text();
            return NextResponse.json(
                { error: `Failed to fetch artist: ${error}` },
                { status: response.status }
            );
        }

        const result: ArtistResponse = await response.json();

        // Update local artist record with fetched metadata
        await db.artist.updateMany({
            where: { appleMusicId: artistId },
            data: {
                artworkUrl: result.artwork_url,
                bio: result.bio,
                genre: result.genre,
                origin: result.origin,
                birthDate: result.birth_date,
                url: result.url,
                lastFetchedAt: new Date()
            }
        });

        return NextResponse.json(result);
    } catch (error) {
        console.error('Error fetching artist:', error);

        if (error instanceof Error && error.name === 'TimeoutError') {
            return NextResponse.json(
                { error: 'Request timeout - is the gamdl service running?' },
                { status: 504 }
            );
        }

        return NextResponse.json(
            { error: 'Failed to fetch artist data' },
            { status: 500 }
        );
    }
}
