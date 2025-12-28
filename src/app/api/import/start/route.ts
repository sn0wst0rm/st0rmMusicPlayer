import { NextResponse } from 'next/server';
import db from '@/lib/db';

const GAMDL_SERVICE_URL = process.env.GAMDL_SERVICE_URL || 'http://127.0.0.1:5100';

// POST start a download job
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { url, type, title, artist, artworkUrl, description, globalId } = body;

        if (!url || typeof url !== 'string') {
            return NextResponse.json(
                { error: 'URL is required' },
                { status: 400 }
            );
        }

        // Get settings with cookies
        const settings = await db.gamdlSettings.findUnique({
            where: { id: 'singleton' }
        });

        if (!settings?.cookies) {
            return NextResponse.json(
                { error: 'Please configure Apple Music cookies in settings first' },
                { status: 400 }
            );
        }

        // Create import job record
        const job = await db.importJob.create({
            data: {
                url,
                type: type || 'unknown',
                title: title || 'Unknown',
                artist: artist || null,
                description: description || null,
                globalId: globalId || null,
                artworkUrl: artworkUrl || null,
                status: 'pending',
                progress: 0
            }
        });

        // Start the download via Python service (SSE stream)
        // The status endpoint will handle the actual download and DB updates
        return NextResponse.json({
            jobId: job.id,
            status: 'pending',
            message: 'Download queued. Use /api/import/status/{jobId} to stream progress.'
        });
    } catch (error) {
        console.error('Error starting import:', error);
        return NextResponse.json(
            { error: 'Failed to start import' },
            { status: 500 }
        );
    }
}

// GET list recent import jobs
export async function GET() {
    try {
        const jobs = await db.importJob.findMany({
            orderBy: { createdAt: 'desc' },
            take: 50
        });

        return NextResponse.json(jobs);
    } catch (error) {
        console.error('Error fetching import jobs:', error);
        return NextResponse.json(
            { error: 'Failed to fetch import jobs' },
            { status: 500 }
        );
    }
}
