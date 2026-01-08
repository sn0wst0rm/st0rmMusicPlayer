import { NextRequest, NextResponse } from 'next/server';
import { createReadStream, statSync, existsSync } from 'fs';
import { Readable } from 'stream';
import prisma from '@/lib/db';

interface RouteParams {
    params: Promise<{ albumId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
    const { albumId } = await params;
    const { searchParams } = new URL(request.url);
    const size = searchParams.get('size') || 'large';

    // Fetch album from database
    const album = await prisma.album.findUnique({
        where: { id: albumId },
        select: {
            animatedCoverPath: true,
            animatedCoverSmallPath: true,
        },
    });

    if (!album) {
        return NextResponse.json({ error: 'Album not found' }, { status: 404 });
    }

    // Select appropriate file based on size parameter
    const filePath = size === 'small'
        ? (album.animatedCoverSmallPath || album.animatedCoverPath)
        : album.animatedCoverPath;

    console.log(`[API] Animated Cover Request: ${albumId} size=${size}`);
    console.log(`[API] Resolved Path: ${filePath}`);

    if (!filePath) {
        return NextResponse.json({ error: 'No animated cover available' }, { status: 404 });
    }

    // Check if file exists
    if (!existsSync(filePath)) {
        console.log(`[API] File not found at path: ${filePath}`);
        return NextResponse.json({ error: 'Animated cover file not found' }, { status: 404 });
    }

    // Get file stats for content-length
    const stat = statSync(filePath);

    // Determine content type based on file extension
    const isGif = filePath.toLowerCase().endsWith('.gif');
    const contentType = isGif ? 'image/gif' : 'video/mp4';

    console.log(`[API] Serving Content-Type: ${contentType}`);

    // For GIFs, just serve the file directly (no range requests needed)
    const stream = createReadStream(filePath);
    const webStream = Readable.toWeb(stream) as ReadableStream;

    return new Response(webStream, {
        headers: {
            'Content-Type': contentType,
            'Content-Length': stat.size.toString(),
            'Cache-Control': 'public, max-age=31536000, immutable',
        },
    });
}
