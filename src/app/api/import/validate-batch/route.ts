import { NextResponse } from 'next/server';
import db from '@/lib/db';

const GAMDL_SERVICE_URL = process.env.GAMDL_SERVICE_URL || 'http://127.0.0.1:5100';

// Helper to get downloaded codecs for a track by Apple Music ID
async function getDownloadedCodecs(appleMusicId: string): Promise<string[]> {
    if (!appleMusicId) return [];

    // Import fs dynamically to avoid issues if used in edge runtime (though this is node runtime)
    const fs = await import('fs');

    try {
        const tracks = await db.track.findMany({
            where: { appleMusicId },
            select: { codecPaths: true, filePath: true }
        });


        const downloaded = new Set<string>();
        for (const track of tracks) {
            // Verify the main file exists
            if (!track.filePath || !fs.existsSync(track.filePath)) {
                continue;
            }


            // Parse codecPaths JSON field
            if (track.codecPaths) {
                try {
                    const codecPaths = JSON.parse(track.codecPaths);
                    Object.entries(codecPaths).forEach(([codec, path]) => {
                        // Check if this specific codec file exists
                        if (typeof path === 'string' && fs.existsSync(path)) {
                            downloaded.add(codec);
                        } else {
                        }
                    });
                } catch { /* ignore parse errors */ }
            }

            // Also infer from file path patterns like "[aac-legacy].m4a"
            const match = track.filePath.match(/\[([^\]]+)\]\.m4a$/);
            if (match) {
                downloaded.add(match[1]);
            } else {
                if (track.filePath.endsWith('.m4a')) {
                }
            }
        }
        return Array.from(downloaded);
    } catch (error) {
        console.error('Error querying downloaded codecs:', error);
        return [];
    }
}

// POST validate multiple Apple Music URLs from text
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { text } = body;

        if (!text || typeof text !== 'string') {
            return NextResponse.json(
                { error: 'Text is required' },
                { status: 400 }
            );
        }

        // Get cookies from settings
        const settings = await db.gamdlSettings.findUnique({
            where: { id: 'singleton' }
        });

        // Proxy to Python service
        const response = await fetch(`${GAMDL_SERVICE_URL}/validate-batch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text,
                cookies: settings?.cookies || null
            }),
            signal: AbortSignal.timeout(120000) // 120s for batch operations
        });

        if (!response.ok) {
            const error = await response.text();
            return NextResponse.json(
                { error: `Batch validation failed: ${error}` },
                { status: response.status }
            );
        }

        const result = await response.json();

        // Enrich results with downloaded codecs from database
        if (result.items && Array.isArray(result.items)) {
            for (const item of result.items) {
                if (item.type === 'song' && item.apple_music_id) {
                    item.downloaded_codecs = await getDownloadedCodecs(item.apple_music_id);
                }
            }
        }

        return NextResponse.json(result);
    } catch (error) {
        console.error('Error validating batch URLs:', error);

        if (error instanceof Error && error.name === 'TimeoutError') {
            return NextResponse.json(
                { error: 'Service timeout - is the gamdl service running?' },
                { status: 504 }
            );
        }

        return NextResponse.json(
            { error: 'Failed to validate URLs. Make sure the gamdl service is running.' },
            { status: 500 }
        );
    }
}
