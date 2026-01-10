import { NextResponse } from 'next/server';
import db from '@/lib/db';

const GAMDL_SERVICE_URL = process.env.GAMDL_SERVICE_URL || 'http://127.0.0.1:5100';

export interface SearchResultItem {
    type: 'song' | 'album'
    apple_music_id: string
    title: string
    artist?: string
    artwork_url?: string
    track_count?: number
    album_name?: string
    duration_ms?: number
}

export interface SearchResponse {
    songs: SearchResultItem[]
    albums: SearchResultItem[]
    term: string
    storefront: string
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { term } = body;

        if (!term || typeof term !== 'string' || term.length < 2) {
            return NextResponse.json(
                { error: 'Search term must be at least 2 characters' },
                { status: 400 }
            );
        }

        // Get cookies from settings
        const settings = await db.gamdlSettings.findUnique({
            where: { id: 'singleton' }
        });

        if (!settings?.cookies) {
            return NextResponse.json(
                { error: 'Apple Music cookies not configured. Please configure in settings.' },
                { status: 400 }
            );
        }

        // Proxy to Python service
        const response = await fetch(`${GAMDL_SERVICE_URL}/search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                term,
                cookies: settings.cookies,
                types: 'songs,albums',
                limit: 25
            }),
            signal: AbortSignal.timeout(30000)
        });

        if (!response.ok) {
            const error = await response.text();
            return NextResponse.json(
                { error: `Search failed: ${error}` },
                { status: response.status }
            );
        }

        const result: SearchResponse = await response.json();
        return NextResponse.json(result);

    } catch (error) {
        console.error('Error searching catalog:', error);

        if (error instanceof Error && error.name === 'TimeoutError') {
            return NextResponse.json(
                { error: 'Search timeout - is the gamdl service running?' },
                { status: 504 }
            );
        }

        return NextResponse.json(
            { error: 'Search failed. Make sure the gamdl service is running.' },
            { status: 500 }
        );
    }
}
