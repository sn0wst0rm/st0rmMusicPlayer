// Script to update album records with existing animated cover paths
import prisma from '../src/lib/db.js';
import { existsSync } from 'fs';
import { join, dirname } from 'path';

async function updateAnimatedCovers() {
    console.log('Scanning albums for existing animated covers...');

    const albums = await prisma.album.findMany({
        include: { tracks: { take: 1 } }
    });

    let updated = 0;
    for (const album of albums) {
        if (album.tracks.length === 0) continue;

        const trackDir = dirname(album.tracks[0].filePath);

        // Check for GIF first (current format), then MP4 (legacy)
        const animatedGifPath = join(trackDir, 'cover-animated.gif');
        const animatedMp4Path = join(trackDir, 'cover-animated.mp4');
        const animatedSmallGifPath = join(trackDir, 'cover-animated-small.gif');
        const animatedSmallMp4Path = join(trackDir, 'cover-animated-small.mp4');

        const animatedPath = existsSync(animatedGifPath) ? animatedGifPath :
            existsSync(animatedMp4Path) ? animatedMp4Path : null;
        const animatedSmallPath = existsSync(animatedSmallGifPath) ? animatedSmallGifPath :
            existsSync(animatedSmallMp4Path) ? animatedSmallMp4Path : null;

        if (animatedPath) {
            await prisma.album.update({
                where: { id: album.id },
                data: {
                    animatedCoverPath: animatedPath,
                    animatedCoverSmallPath: animatedSmallPath
                }
            });
            console.log('Updated:', album.title, '->', animatedPath);
            updated++;
        }
    }

    console.log('Total albums updated:', updated);
    await prisma.$disconnect();
}

updateAnimatedCovers().catch(console.error);
