import fs from 'fs';
import path from 'path';
import * as mm from 'music-metadata';
import db from './db';
import { glob } from 'glob';

const IGNORE_DIRS = ['node_modules', '.git'];

// Fetches the library path from database settings (source of truth)
export async function getLibraryPath(): Promise<string> {
    const settings = await db.gamdlSettings.findUnique({
        where: { id: 'singleton' },
        select: { mediaLibraryPath: true }
    });
    return settings?.mediaLibraryPath || './music';
}

export async function scanLibrary() {
    const LIBRARY_ROOT = await getLibraryPath();
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
    // m4a files are treated as source, mp3 files as derivatives
    const isMp3 = path.extname(filePath).toLowerCase() === '.mp3';

    if (!isMp3) {
        // Source file (m4a)
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
            // We'll add it to codecPaths as an additional format
            const existingTrack = await db.track.findUnique({
                where: { filePath: sourcePath }
            });

            if (existingTrack) {
                // Add mp3 to codecPaths
                let codecPaths: Record<string, string> = {};
                if (existingTrack.codecPaths) {
                    try {
                        codecPaths = JSON.parse(existingTrack.codecPaths);
                    } catch { /* ignore */ }
                }
                // Determine original codec
                if (!codecPaths['aac-legacy']) {
                    codecPaths['aac-legacy'] = sourcePath;
                }
                codecPaths['mp3'] = filePath;

                await db.track.update({
                    where: { id: existingTrack.id },
                    data: { codecPaths: JSON.stringify(codecPaths) }
                });
            } else {
                // Source not indexed yet - create with both paths in codecPaths
                const codecPaths = { 'aac-legacy': sourcePath, 'mp3': filePath };
                await db.track.create({
                    data: {
                        title,
                        duration,
                        trackNumber,
                        filePath: sourcePath,
                        codecPaths: JSON.stringify(codecPaths),
                        albumId: album.id,
                        artistId: artist.id,
                    }
                });
            }

        } else {
            // No source file found. This MP3 is a standalone track.
            const codecPaths = { 'mp3': filePath };
            await db.track.upsert({
                where: { filePath: filePath },
                create: {
                    title,
                    duration,
                    trackNumber,
                    filePath: filePath,
                    codecPaths: JSON.stringify(codecPaths),
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
