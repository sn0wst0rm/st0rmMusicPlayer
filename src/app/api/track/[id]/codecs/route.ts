import { NextResponse } from 'next/server';
import db from '@/lib/db';

// GET available codecs for a track
export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;

    const track = await db.track.findUnique({
        where: { id },
        select: {
            id: true,
            codecPaths: true,
            preferredCodec: true,
            filePath: true
        }
    });

    if (!track) {
        return NextResponse.json(
            { error: 'Track not found' },
            { status: 404 }
        );
    }

    // Parse codecPaths JSON
    let codecs: Record<string, string> = {};
    if (track.codecPaths) {
        try {
            codecs = JSON.parse(track.codecPaths);
        } catch {
            // Fallback: if codecPaths is invalid, use filePath with default codec
            codecs = { 'aac-legacy': track.filePath };
        }
    } else {
        // No codecPaths stored, use filePath as default
        codecs = { 'aac-legacy': track.filePath };
    }

    const available = Object.keys(codecs);
    const current = track.preferredCodec || available[0] || 'aac-legacy';

    return NextResponse.json({
        trackId: id,
        available,
        current,
        paths: codecs
    });
}

// PATCH update preferred codec for a track
export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const body = await request.json();
    const { codec } = body;

    if (!codec || typeof codec !== 'string') {
        return NextResponse.json(
            { error: 'Codec is required' },
            { status: 400 }
        );
    }

    const track = await db.track.findUnique({
        where: { id },
        select: { codecPaths: true }
    });

    if (!track) {
        return NextResponse.json(
            { error: 'Track not found' },
            { status: 404 }
        );
    }

    // Verify codec is available
    let availableCodecs: string[] = [];
    if (track.codecPaths) {
        try {
            availableCodecs = Object.keys(JSON.parse(track.codecPaths));
        } catch {
            availableCodecs = ['aac-legacy'];
        }
    }

    if (!availableCodecs.includes(codec)) {
        return NextResponse.json(
            { error: 'Codec not available for this track' },
            { status: 400 }
        );
    }

    // Update preferred codec
    const updated = await db.track.update({
        where: { id },
        data: { preferredCodec: codec }
    });

    return NextResponse.json({
        trackId: id,
        preferredCodec: updated.preferredCodec
    });
}
