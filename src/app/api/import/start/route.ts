import { NextResponse } from 'next/server';
import db from '@/lib/db';

const GAMDL_SERVICE_URL = process.env.GAMDL_SERVICE_URL || 'http://127.0.0.1:5100';

// POST start a download job
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { url, type, title, artist, artworkUrl, description, globalId, selectedCodecs } = body;

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
                progress: 0,
                // Store selected codecs if provided (array to comma-separated string)
                selectedCodecs: Array.isArray(selectedCodecs) && selectedCodecs.length > 0
                    ? selectedCodecs.join(',')
                    : null
            }
        });

        // Trigger the download via Python service (Fire and Forget / Background)
        try {
            const pythonRes = await fetch(`${GAMDL_SERVICE_URL}/download`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url: url,
                    cookies: settings.cookies,
                    output_path: settings.outputPath || './music',
                    // Use selected codecs if provided, otherwise default to settings
                    song_codecs: (Array.isArray(selectedCodecs) && selectedCodecs.length > 0)
                        ? selectedCodecs.join(',')
                        : (settings.songCodecs || 'aac-legacy'),
                    lyrics_format: settings.lyricsFormat || 'ttml',
                    cover_size: settings.coverSize || 1200,
                    save_cover: settings.saveCover ?? true,
                    language: settings.language || 'en-US',
                    overwrite: settings.overwrite ?? false,
                    // Pass empty strings for extended lyrics settings if not in DB yet
                    lyrics_translation_langs: "",
                    lyrics_pronunciation_langs: ""
                })
            });

            if (!pythonRes.ok) {
                const errText = await pythonRes.text();
                console.error("Python service failed to start download:", errText);
                // Update job status to failed
                await db.importJob.update({
                    where: { id: job.id },
                    data: { status: 'failed' }
                });
                return NextResponse.json(
                    { error: `Failed to start download service: ${errText}` },
                    { status: 500 }
                );
            }

        } catch (pyErr) {
            console.error("Failed to contact Python service:", pyErr);
            await db.importJob.update({
                where: { id: job.id },
                data: { status: 'failed' }
            });
            return NextResponse.json({ error: 'Failed to contact download service' }, { status: 500 });
        }

        return NextResponse.json({
            jobId: job.id,
            status: 'pending',
            message: 'Download started.'
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
