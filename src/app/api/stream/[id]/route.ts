import { NextResponse } from 'next/server';
import db from '@/lib/db';
import fs from 'fs';

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> } // Params are now Promises in Next.js 15 (if applicable, assuming latest)
) {
    const { id } = await params;

    const track = await db.track.findUnique({
        where: { id },
    });

    if (!track) {
        return new NextResponse('Track not found', { status: 404 });
    }

    // Prefer MP3 if available, otherwise original
    const filePath = track.mp3Path || track.filePath;

    if (!fs.existsSync(filePath)) {
        return new NextResponse('File not found on disk', { status: 404 });
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = request.headers.get('range');

    if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = (end - start) + 1;
        const file = fs.createReadStream(filePath, { start, end });

        // Convert stream to ReadableStream for web response
        // Node stream to Web stream
        const readable = new ReadableStream({
            start(controller) {
                file.on('data', (chunk) => controller.enqueue(chunk));
                file.on('end', () => controller.close());
                file.on('error', (err) => controller.error(err));
            }
        });

        return new NextResponse(readable, {
            status: 206,
            headers: {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunksize.toString(),
                'Content-Type': 'audio/mpeg', // Determine correctly ideally
            },
        });
    } else {
        const file = fs.createReadStream(filePath);

        const readable = new ReadableStream({
            start(controller) {
                file.on('data', (chunk) => controller.enqueue(chunk));
                file.on('end', () => controller.close());
                file.on('error', (err) => controller.error(err));
            }
        });

        return new NextResponse(readable, {
            status: 200,
            headers: {
                'Content-Length': fileSize.toString(),
                'Content-Type': 'audio/mpeg',
            },
        });
    }
}
