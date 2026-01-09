import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import db from '@/lib/db';

interface RouteParams {
    params: Promise<{ id: string }>;
}

// Helper to get the library output path
async function getLibraryPath(): Promise<string> {
    const settings = await db.gamdlSettings.findUnique({
        where: { id: 'singleton' },
        select: { mediaLibraryPath: true }
    });
    return settings?.mediaLibraryPath || './music';
}

// POST upload cover image for playlist
export async function POST(request: NextRequest, { params }: RouteParams) {
    const { id: playlistId } = await params;

    try {
        // Check if playlist exists and is not synced
        const playlist = await db.playlist.findUnique({
            where: { id: playlistId },
            select: { isSynced: true, name: true }
        });

        if (!playlist) {
            return NextResponse.json(
                { error: 'Playlist not found' },
                { status: 404 }
            );
        }

        if (playlist.isSynced) {
            return NextResponse.json(
                { error: 'Cannot modify a synced playlist cover' },
                { status: 403 }
            );
        }

        // Parse multipart form data
        const formData = await request.formData();
        const file = formData.get('cover') as File | null;

        if (!file) {
            return NextResponse.json(
                { error: 'No cover file provided' },
                { status: 400 }
            );
        }

        // Validate file type
        const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
        if (!allowedTypes.includes(file.type)) {
            return NextResponse.json(
                { error: 'Invalid file type. Allowed: JPEG, PNG, WebP, GIF' },
                { status: 400 }
            );
        }

        // Get library path and create .playlist-covers directory inside it
        const libraryPath = await getLibraryPath();
        const coversDir = path.join(libraryPath, '.playlist-covers');

        if (!fs.existsSync(coversDir)) {
            fs.mkdirSync(coversDir, { recursive: true });
        }

        // Generate filename - use extension from original file
        const ext = path.extname(file.name) || '.jpg';
        const filename = `${playlistId}${ext}`;
        const coverFullPath = path.join(coversDir, filename);

        // Delete old cover if exists with different extension
        const extensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
        for (const oldExt of extensions) {
            const oldPath = path.join(coversDir, `${playlistId}${oldExt}`);
            if (oldPath !== coverFullPath && fs.existsSync(oldPath)) {
                fs.unlinkSync(oldPath);
            }
        }

        // Save file
        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);
        fs.writeFileSync(coverFullPath, buffer);

        // Store the full absolute path for serving
        const absolutePath = path.resolve(coverFullPath);

        await db.playlist.update({
            where: { id: playlistId },
            data: { coverPath: absolutePath }
        });

        return NextResponse.json({
            success: true,
            coverPath: absolutePath
        });
    } catch (error) {
        console.error('Error uploading playlist cover:', error);
        return NextResponse.json(
            { error: 'Failed to upload cover' },
            { status: 500 }
        );
    }
}

// DELETE remove cover image from playlist
export async function DELETE(request: NextRequest, { params }: RouteParams) {
    const { id: playlistId } = await params;

    try {
        // Check if playlist exists
        const playlist = await db.playlist.findUnique({
            where: { id: playlistId },
            select: { isSynced: true, coverPath: true }
        });

        if (!playlist) {
            return NextResponse.json(
                { error: 'Playlist not found' },
                { status: 404 }
            );
        }

        if (playlist.isSynced) {
            return NextResponse.json(
                { error: 'Cannot modify a synced playlist cover' },
                { status: 403 }
            );
        }

        // Delete file if exists
        if (playlist.coverPath && fs.existsSync(playlist.coverPath)) {
            fs.unlinkSync(playlist.coverPath);
        }

        // Clear cover path in database
        await db.playlist.update({
            where: { id: playlistId },
            data: { coverPath: null }
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error deleting playlist cover:', error);
        return NextResponse.json(
            { error: 'Failed to delete cover' },
            { status: 500 }
        );
    }
}
