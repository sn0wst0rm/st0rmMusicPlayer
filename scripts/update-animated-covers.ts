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
        const animatedPath = join(trackDir, 'cover-animated.mp4');
        const animatedSmallPath = join(trackDir, 'cover-animated-small.mp4');

        if (existsSync(animatedPath)) {
            await prisma.album.update({
                where: { id: album.id },
                data: {
                    animatedCoverPath: animatedPath,
                    animatedCoverSmallPath: existsSync(animatedSmallPath) ? animatedSmallPath : null
                }
            });
            console.log('Updated:', album.title);
            updated++;
        }
    }

    console.log('Total albums updated:', updated);
    await prisma.$disconnect();
}

updateAnimatedCovers().catch(console.error);
