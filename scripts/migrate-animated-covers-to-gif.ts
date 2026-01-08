#!/usr/bin/env npx tsx
// Script to convert existing MP4 animated covers to GIF format
// and update database paths

import prisma from '../src/lib/db.js';
import { existsSync } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { join, dirname } from 'path';

const execAsync = promisify(exec);

async function convertMp4ToGif(mp4Path: string, gifPath: string): Promise<boolean> {
    if (!existsSync(mp4Path)) {
        console.log(`  MP4 not found: ${mp4Path}`);
        return false;
    }

    if (existsSync(gifPath)) {
        console.log(`  GIF already exists: ${gifPath}`);
        return true;
    }

    const dir = dirname(mp4Path);
    const palettePath = join(dir, 'palette_migrate.png');

    try {
        // Generate palette
        console.log('  Generating palette...');
        await execAsync(`ffmpeg -y -i "${mp4Path}" -vf "fps=15,scale=600:-1:flags=lanczos,palettegen=stats_mode=diff" "${palettePath}"`, { timeout: 120000 });

        // Create GIF with palette
        console.log('  Converting to GIF...');
        await execAsync(`ffmpeg -y -i "${mp4Path}" -i "${palettePath}" -lavfi "fps=15,scale=600:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" -loop 0 "${gifPath}"`, { timeout: 120000 });

        // Clean up palette
        if (existsSync(palettePath)) {
            await execAsync(`rm "${palettePath}"`);
        }

        console.log(`  ✅ Created: ${gifPath}`);
        return true;
    } catch (error) {
        console.log(`  ❌ Failed:`, error);
        return false;
    }
}

async function convertSmallMp4ToGif(mp4Path: string, gifPath: string): Promise<boolean> {
    const fullGifPath = mp4Path.replace('-small.mp4', '.gif');
    const sourceForSmall = existsSync(fullGifPath) ? fullGifPath : mp4Path;

    if (!existsSync(sourceForSmall)) {
        return false;
    }

    if (existsSync(gifPath)) {
        console.log(`  Small GIF already exists`);
        return true;
    }

    const dir = dirname(mp4Path);
    const palettePath = join(dir, 'palette_small_migrate.png');

    try {
        await execAsync(`ffmpeg -y -i "${sourceForSmall}" -vf "fps=12,scale=128:-1:flags=lanczos,palettegen" "${palettePath}"`, { timeout: 60000 });
        await execAsync(`ffmpeg -y -i "${sourceForSmall}" -i "${palettePath}" -lavfi "fps=12,scale=128:-1:flags=lanczos[x];[x][1:v]paletteuse" -loop 0 "${gifPath}"`, { timeout: 60000 });

        if (existsSync(palettePath)) {
            await execAsync(`rm "${palettePath}"`);
        }

        console.log(`  ✅ Created small: ${gifPath}`);
        return true;
    } catch (error) {
        console.log(`  ❌ Small failed:`, error);
        return false;
    }
}

async function migrateAnimatedCovers() {
    console.log('Scanning albums for MP4 animated covers to convert to GIF...\n');

    const albums = await prisma.album.findMany({
        where: {
            OR: [
                { animatedCoverPath: { not: null } },
                { animatedCoverSmallPath: { not: null } }
            ]
        },
        include: { tracks: { take: 1 } }
    });

    let converted = 0;
    let skipped = 0;

    for (const album of albums) {
        console.log(`\nAlbum: ${album.title}`);

        let newFullPath = album.animatedCoverPath;
        let newSmallPath = album.animatedCoverSmallPath;

        // Convert full to GIF
        if (album.animatedCoverPath?.endsWith('.mp4')) {
            const gifPath = album.animatedCoverPath.replace('.mp4', '.gif');
            if (await convertMp4ToGif(album.animatedCoverPath, gifPath)) {
                newFullPath = gifPath;
            }
        }

        // Convert small to GIF
        if (album.animatedCoverSmallPath?.endsWith('.mp4')) {
            const gifPath = album.animatedCoverSmallPath.replace('.mp4', '.gif');
            if (await convertSmallMp4ToGif(album.animatedCoverSmallPath, gifPath)) {
                newSmallPath = gifPath;
            }
        } else if (!album.animatedCoverSmallPath && newFullPath?.endsWith('.gif')) {
            // Create small GIF if missing
            const smallGifPath = newFullPath.replace('.gif', '-small.gif');
            const sourceMp4Small = album.animatedCoverPath?.replace('.mp4', '-small.mp4');
            if (sourceMp4Small && existsSync(sourceMp4Small)) {
                if (await convertSmallMp4ToGif(sourceMp4Small, smallGifPath)) {
                    newSmallPath = smallGifPath;
                }
            }
        }

        // Update database if paths changed
        if (newFullPath !== album.animatedCoverPath || newSmallPath !== album.animatedCoverSmallPath) {
            await prisma.album.update({
                where: { id: album.id },
                data: {
                    animatedCoverPath: newFullPath,
                    animatedCoverSmallPath: newSmallPath
                }
            });
            console.log(`  Updated DB paths`);
            converted++;
        } else {
            skipped++;
        }
    }

    console.log(`\n\nDone! Converted: ${converted}, Skipped: ${skipped}`);
    await prisma.$disconnect();
}

migrateAnimatedCovers().catch(console.error);
