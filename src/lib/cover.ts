import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { parseFile } from 'music-metadata';
import prisma from '@/lib/db';
import { getLibraryPath } from '@/lib/scanner';

// Cache directory for generated cover thumbnails - fetched lazily
async function getCacheDir(): Promise<string> {
    const libraryPath = await getLibraryPath();
    const cacheDir = path.join(libraryPath, '.cover-cache');
    if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
    }
    return cacheDir;
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
    // 1. First check for Cover.jpg or Cover.png in the album's folder
    const albumDir = path.dirname(audioFilePath);
    const coverCandidates = ['Cover.jpg', 'Cover.png', 'cover.jpg', 'cover.png', 'Folder.jpg', 'Folder.png'];

    let imageBuffer: Buffer | null = null;

    // Try to find a cover file in the album directory
    for (const coverName of coverCandidates) {
        const coverPath = path.join(albumDir, coverName);
        if (fs.existsSync(coverPath)) {
            imageBuffer = fs.readFileSync(coverPath);
            break;
        }
    }

    // If no cover file found, try to extract from audio files
    if (!imageBuffer) {
        // Try the provided audio file first
        try {
            const metadata = await parseFile(audioFilePath);
            const picture = metadata.common.picture?.[0];
            if (picture) {
                imageBuffer = Buffer.from(picture.data);
            }
        } catch (e) {
            // Files from wrapper might not have readable metadata
        }

        // If still no cover, try other audio files in the directory
        if (!imageBuffer) {
            const audioExtensions = ['.m4a', '.flac', '.mp3', '.aac', '.alac'];
            const files = fs.readdirSync(albumDir);
            for (const file of files) {
                if (audioExtensions.some(ext => file.toLowerCase().endsWith(ext))) {
                    const filePath = path.join(albumDir, file);
                    if (filePath !== audioFilePath) {
                        try {
                            const metadata = await parseFile(filePath);
                            const picture = metadata.common.picture?.[0];
                            if (picture) {
                                imageBuffer = Buffer.from(picture.data);
                                break;
                            }
                        } catch (e) {
                            // Continue to next file
                        }
                    }
                }
            }
        }
    }

    if (!imageBuffer) return null;

    // 2. Generate generic filenames
    // We use albumId to keep it unique and predictable
    const baseFilename = `${albumId}-${Date.now()}`;
    const smallFilename = `${baseFilename}-small.jpg`;
    const mediumFilename = `${baseFilename}-medium.jpg`;
    const largeFilename = `${baseFilename}-large.jpg`;

    const smallPath = path.join(await getCacheDir(), smallFilename);
    const mediumPath = path.join(await getCacheDir(), mediumFilename);
    const largePath = path.join(await getCacheDir(), largeFilename);


    // 3. Process with Sharp

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
