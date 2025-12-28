import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

interface RouteParams {
    params: Promise<{ path: string[] }>;
}

// GET serve playlist cover image
export async function GET(request: NextRequest, { params }: RouteParams) {
    const { path: pathSegments } = await params;

    // Join path segments and decode
    const encodedPath = pathSegments.join('/');
    const coverPath = decodeURIComponent(encodedPath);

    try {
        // Check if file exists
        if (!fs.existsSync(coverPath)) {
            return NextResponse.json(
                { error: 'Cover not found' },
                { status: 404 }
            );
        }

        // Read the file
        const fileBuffer = fs.readFileSync(coverPath);

        // Determine content type from extension
        const ext = path.extname(coverPath).toLowerCase();
        let contentType = 'image/jpeg';
        if (ext === '.png') contentType = 'image/png';
        else if (ext === '.webp') contentType = 'image/webp';
        else if (ext === '.gif') contentType = 'image/gif';

        return new NextResponse(fileBuffer, {
            headers: {
                'Content-Type': contentType,
                'Cache-Control': 'public, max-age=31536000, immutable',
            },
        });
    } catch (error) {
        console.error('Error serving playlist cover:', error);
        return NextResponse.json(
            { error: 'Failed to serve cover' },
            { status: 500 }
        );
    }
}
