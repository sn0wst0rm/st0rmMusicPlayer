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

    // Determine which file to stream - prioritize codecPaths over legacy filePath
    let filePath: string | null = null;
    let codecPaths: Record<string, string> = {};

    // Parse codecPaths if available
    if (track.codecPaths) {
        try {
            codecPaths = JSON.parse(track.codecPaths) as Record<string, string>;
        } catch (e) {
            // Invalid JSON, treat as empty
        }
    }

    // Priority 1: Use explicitly requested codec
    if (requestedCodec && codecPaths[requestedCodec]) {
        if (fs.existsSync(codecPaths[requestedCodec])) {
            filePath = codecPaths[requestedCodec];
        }
    }

    // Priority 2: Use preferred codec if set
    if (!filePath && track.preferredCodec && codecPaths[track.preferredCodec]) {
        if (fs.existsSync(codecPaths[track.preferredCodec])) {
            filePath = codecPaths[track.preferredCodec];
        }
    }

    // Priority 3: Use first available valid codec from codecPaths
    if (!filePath && Object.keys(codecPaths).length > 0) {
        for (const codec of Object.keys(codecPaths)) {
            if (fs.existsSync(codecPaths[codec])) {
                filePath = codecPaths[codec];
                break;
            }
        }
    }

    // Priority 4: Fall back to legacy filePath (for old tracks without codecPaths)
    if (!filePath && track.filePath && fs.existsSync(track.filePath)) {
        filePath = track.filePath;
    }

    // Guard: filePath must be set and exist at this point
    if (!filePath || !fs.existsSync(filePath)) {
        return new NextResponse('File not found on disk', { status: 404 });
    }

    // Stream the file directly - browser handles codec compatibility
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
    }

    // Full file request
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
        headers: {
            'Content-Length': fileSize.toString(),
            'Content-Type': contentType,
            'Accept-Ranges': 'bytes',
        },
    });
}
