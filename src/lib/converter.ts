import ffmpeg from 'fluent-ffmpeg';
import db from './db';
import path from 'path';
import fs from 'fs';

export async function convertLibrary() {
    console.log('Starting library conversion check...');

    // Find tracks with no mp3Path
    const tracksToConvert = await db.track.findMany({
        where: {
            mp3Path: null,
            filePath: {
                not: {
                    endsWith: '.mp3' // Don't try to convert if it's already source mp3 (logic from scanner handles this but double check)
                }
            }
        }
    });

    console.log(`Found ${tracksToConvert.length} tracks needing conversion.`);

    for (const track of tracksToConvert) {
        try {
            if (!track.filePath.endsWith('.mp3')) {
                await convertTrack(track);
            }
        } catch (error) {
            console.error(`Failed to convert track ${track.title}:`, error);
        }
    }

    console.log('Library conversion complete.');
}

async function convertTrack(track: any) {
    const inputPath = track.filePath;
    const ext = path.extname(inputPath);
    const basename = path.basename(inputPath, ext);
    const dir = path.dirname(inputPath);
    const outputPath = path.join(dir, `${basename}.mp3`);

    // If output already exists (e.g. from previous run but DB desync), just update DB
    if (fs.existsSync(outputPath)) {
        console.log(`MP3 already exists for ${track.title}, updating DB.`);
        await db.track.update({
            where: { id: track.id },
            data: { mp3Path: outputPath }
        });
        return;
    }

    console.log(`Converting ${track.title} to MP3...`);

    return new Promise<void>((resolve, reject) => {
        ffmpeg(inputPath)
            .toFormat('mp3')
            .audioBitrate(320)
            .on('end', async () => {
                console.log(`Conversion finished: ${track.title}`);
                await db.track.update({
                    where: { id: track.id },
                    data: { mp3Path: outputPath }
                });
                resolve();
            })
            .on('error', (err) => {
                console.error(`Error converting ${track.title}:`, err);
                reject(err);
            })
            .save(outputPath);
    });
}
