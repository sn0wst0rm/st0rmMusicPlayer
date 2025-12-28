import { NextResponse } from 'next/server';
import db from '@/lib/db';

const GAMDL_SERVICE_URL = process.env.GAMDL_SERVICE_URL || 'http://127.0.0.1:5100';

// POST validate Apple Music URL
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { url } = body;

        if (!url || typeof url !== 'string') {
            return NextResponse.json(
                { error: 'URL is required' },
                { status: 400 }
            );
        }

        // Get cookies from settings
        const settings = await db.gamdlSettings.findUnique({
            where: { id: 'singleton' }
        });

        // Proxy to Python service
        const response = await fetch(`${GAMDL_SERVICE_URL}/validate-url`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                url,
                cookies: settings?.cookies || null
            }),
            signal: AbortSignal.timeout(120000) // 120s to allow for slow API initialization
        });

        if (!response.ok) {
            const error = await response.text();
            return NextResponse.json(
                { error: `Validation failed: ${error}` },
                { status: response.status }
            );
        }

        const result = await response.json();
        return NextResponse.json(result);
    } catch (error) {
        console.error('Error validating URL:', error);

        if (error instanceof Error && error.name === 'TimeoutError') {
            return NextResponse.json(
                { error: 'Service timeout - is the gamdl service running?' },
                { status: 504 }
            );
        }

        return NextResponse.json(
            { error: 'Failed to validate URL. Make sure the gamdl service is running.' },
            { status: 500 }
        );
    }
}
