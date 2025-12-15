import fs from 'fs';
import path from 'path';
import * as mm from 'music-metadata';
import db from './db';
import { glob } from 'glob';

// Root directory for music (one level up from project)
export const LIBRARY_ROOT = '/media/sn0wst0rm/megaDrive/musica';
const IGNORE_DIRS = ['node_modules', '.git'];

export async function scanLibrary() {
    console.log('Starting library scan from:', LIBRARY_ROOT);

    // Find all audio files
    // We look for m4a, mp3, flac, wav
    const files = await glob('**/*.{m4a,mp3,flac,wav,m4p}', {
        cwd: LIBRARY_ROOT,
        ignore: IGNORE_DIRS.map(d => `${d}/**`),
        absolute: true
    });

    console.log(`Found ${files.length} audio files.`);

    for (const filePath of files) {
        try {
            await processFile(filePath);
        } catch (error) {
            console.error(`Failed to process ${filePath}:`, error);
        }
    }

    console.log('Library scan complete.');
}

async function processFile(filePath: string) {
    // 1. Parse Metadata
    const metadata = await mm.parseFile(filePath);
    const common = metadata.common;
    const format = metadata.format;

    const artistName = common.artist || common.albumartist || 'Unknown Artist';
    const albumTitle = common.album || 'Unknown Album';
    const title = common.title || path.basename(filePath, path.extname(filePath));
    const trackNumber = common.track.no || 0;
    const duration = format.duration || 0;

    // 2. Upsert Artist
    const artist = await db.artist.upsert({
        where: { name: artistName },
        create: { name: artistName },
        update: {},
    });

    // 3. Upsert Album
    const album = await db.album.upsert({
        where: {
            title_artistId: {
                title: albumTitle,
                artistId: artist.id,
            },
        },
        create: {
            title: albumTitle,
            artistId: artist.id,
            // We could extract cover art here later
        },
        update: {},
    });

    // 4. Upsert Track
    // Check if this is an mp3 or generic audio
    const isMp3 = path.extname(filePath).toLowerCase() === '.mp3';

    // Strategy:
    // If we find an m4a, we treat it as an original.
    // If we find an mp3, we need to check if it's an "original" mp3 or a conversion of an m4a.
    // For simplicity:
    // - If file is m4a, upsert Track with filePath = m4a.
    // - If file is mp3, check if a generic track exists (by title/album/artist? or just assume it might be a conversion).
    //
    // Revised Strategy:
    // We index everything.
    // If we find an m4a, we set filePath.
    // If we find an mp3, we set mp3Path IF a track with same title/album exists? 
    // OR we just allow multiple tracks?
    // User wants "automatically converts the m4a files to the best mp3".
    // This implies the m4a is the source. The mp3 is the derivative.

    if (!isMp3) {
        // This is a source file (likely m4a)
        await db.track.upsert({
            where: { filePath: filePath },
            create: {
                title,
                duration,
                trackNumber,
                filePath,
                albumId: album.id,
                artistId: artist.id,
            },
            update: {
                title,
                duration,
                trackNumber,
                albumId: album.id,
                artistId: artist.id,
            },
        });
    } else {
        // This is an mp3.
        // Check if there is a corresponding m4a file in the same folder with same basename.
        const ext = path.extname(filePath);
        const basename = path.basename(filePath, ext);
        const dir = path.dirname(filePath);

        // Look for potential source files in same dir
        const potentialSourceM4a = path.join(dir, `${basename}.m4a`);
        const potentialSourceM4p = path.join(dir, `${basename}.m4p`);

        let sourcePath = null;
        if (fs.existsSync(potentialSourceM4a)) sourcePath = potentialSourceM4a;
        else if (fs.existsSync(potentialSourceM4p)) sourcePath = potentialSourceM4p;

        if (sourcePath) {
            // This mp3 matches a source file. Update that source file's record to include this mp3.
            // We assume the source file has been or will be indexed.
            // We'll try to update the track with filePath == sourcePath.
            // If it doesn't exist yet, we can create it? Or wait?
            // Better to just update if exists, or do nothing. Next scan pass or order of operations will catch it.
            // Actually, upsert is safer.

            await db.track.upsert({
                where: { filePath: sourcePath }, // Key off the SOURCE file
                create: {
                    title,
                    duration,
                    trackNumber,
                    filePath: sourcePath,
                    mp3Path: filePath, // The derived file
                    albumId: album.id,
                    artistId: artist.id,
                },
                update: {
                    mp3Path: filePath
                }
            });

        } else {
            // No source file found. This MP3 is a standalone track (e.g. downloaded mp3).
            // Treat it as a primary track.
            await db.track.upsert({
                where: { filePath: filePath },
                create: {
                    title,
                    duration,
                    trackNumber,
                    filePath: filePath, // It's its own source
                    mp3Path: filePath, // And its own mp3
                    albumId: album.id,
                    artistId: artist.id,
                },
                update: {
                    title,
                    duration,
                    trackNumber,
                    albumId: album.id,
                    artistId: artist.id,
                },
            });
        }
    }
}
