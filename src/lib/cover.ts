import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { parseFile } from 'music-metadata';
import prisma from '@/lib/db';
import { LIBRARY_ROOT } from '@/lib/scanner';

const CACHE_DIR = path.join(LIBRARY_ROOT, '.cover-cache');

// Ensure cache directory exists
if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
}

export type CoverSize = 'small' | 'medium' | 'large';

export async function getCoverPath(albumId: string, size: CoverSize): Promise<string | null> {
    const album = await prisma.album.findUnique({
        where: { id: albumId },
        select: {
            coverSmallPath: true,
            coverMediumPath: true,
            coverLargePath: true,
        },
    });

    if (!album) return null;

    if (size === 'small') return album.coverSmallPath;
    if (size === 'medium') return album.coverMediumPath;
    return album.coverLargePath;
}

export async function generateCovers(albumId: string, audioFilePath: string) {
    // 1. Extract cover from audio file
    const metadata = await parseFile(audioFilePath);
    const picture = metadata.common.picture?.[0];

    if (!picture) return null;

    // 2. Generate generic filenames
    // We use albumId to keep it unique and predictable
    const baseFilename = `${albumId}-${Date.now()}`;
    const smallFilename = `${baseFilename}-small.jpg`;
    const mediumFilename = `${baseFilename}-medium.jpg`;
    const largeFilename = `${baseFilename}-large.jpg`;

    const smallPath = path.join(CACHE_DIR, smallFilename);
    const mediumPath = path.join(CACHE_DIR, mediumFilename);
    const largePath = path.join(CACHE_DIR, largeFilename);

    // 3. Process with Sharp
    const imageBuffer = picture.data;

    // Parallel processing
    await Promise.all([
        sharp(imageBuffer).resize(96).jpeg({ quality: 80 }).toFile(smallPath),
        sharp(imageBuffer).resize(512).jpeg({ quality: 80 }).toFile(mediumPath),
        sharp(imageBuffer).jpeg({ quality: 90 }).toFile(largePath), // Keep original size but convert to jpeg for consistency? Or just save original? requested "original" but consistent format is easier for serving.
    ]);

    // 4. Update Database
    await prisma.album.update({
        where: { id: albumId },
        data: {
            coverSmallPath: smallPath,
            coverMediumPath: mediumPath,
            coverLargePath: largePath,
        },
    });

    return {
        small: smallPath,
        medium: mediumPath,
        large: largePath,
    };
}
