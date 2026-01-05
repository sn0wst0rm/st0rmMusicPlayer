import { NextResponse } from 'next/server';
import db from '@/lib/db';
import fs from 'fs';
import path from 'path';

// Map of file extensions to MIME types
const MIME_TYPES: Record<string, string> = {
    '.m4a': 'audio/mp4',
    '.mp4': 'audio/mp4',
    '.mp3': 'audio/mpeg',
    '.flac': 'audio/flac',
    '.alac': 'audio/mp4',
    '.aac': 'audio/aac',
    '.ac3': 'audio/ac3',
    '.wav': 'audio/wav',
};

function getContentType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    return MIME_TYPES[ext] || 'audio/mp4';
}

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const url = new URL(request.url);
    const requestedCodec = url.searchParams.get('codec');

    const track = await db.track.findUnique({
        where: { id },
    });

    if (!track) {
        return new NextResponse('Track not found', { status: 404 });
    }

    // Determine which file to stream
    let filePath = track.filePath;

    // If codec is requested and we have codecPaths, use the specific codec file
    if (requestedCodec && track.codecPaths) {
        try {
            const codecPaths = JSON.parse(track.codecPaths) as Record<string, string>;
            if (codecPaths[requestedCodec] && fs.existsSync(codecPaths[requestedCodec])) {
                filePath = codecPaths[requestedCodec];
            }
        } catch (e) {
            // Fallback to default filePath
        }
    } else if (track.preferredCodec && track.codecPaths) {
        // Use preferred codec if set
        try {
            const codecPaths = JSON.parse(track.codecPaths) as Record<string, string>;
            if (codecPaths[track.preferredCodec] && fs.existsSync(codecPaths[track.preferredCodec])) {
                filePath = codecPaths[track.preferredCodec];
            }
        } catch (e) {
            // Fallback to default filePath
        }
    }

    if (!fs.existsSync(filePath)) {
        return new NextResponse('File not found on disk', { status: 404 });
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const contentType = getContentType(filePath);
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
                file.on('data', (chunk) => {
                    try {
                        controller.enqueue(chunk);
                    } catch (e) {
                        file.destroy();
                    }
                });
                file.on('end', () => {
                    try { controller.close(); } catch (e) { }
                });
                file.on('error', (err) => {
                    try { controller.error(err); } catch (e) { }
                });
            },
            cancel() {
                file.destroy();
            }
        });

        return new NextResponse(readable, {
            status: 206,
            headers: {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunksize.toString(),
                'Content-Type': contentType,
            },
        });
    } else {
        const file = fs.createReadStream(filePath);

        const readable = new ReadableStream({
            start(controller) {
                file.on('data', (chunk) => {
                    try {
                        controller.enqueue(chunk);
                    } catch (e) {
                        file.destroy();
                    }
                });
                file.on('end', () => {
                    try { controller.close(); } catch (e) { }
                });
                file.on('error', (err) => {
                    try { controller.error(err); } catch (e) { }
                });
            },
            cancel() {
                file.destroy();
            }
        });

        return new NextResponse(readable, {
            status: 200,
            headers: {
                'Content-Length': fileSize.toString(),
                'Content-Type': contentType,
            },
        });
    }
}
