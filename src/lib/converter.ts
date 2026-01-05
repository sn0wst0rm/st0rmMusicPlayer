/**
 * Library Converter (Deprecated)
 * 
 * This module was previously used to convert m4a files to mp3.
 * It has been replaced by the multi-codec download system where
 * users can choose which formats to download from Apple Music.
 * 
 * The codecPaths field on Track now stores paths for each codec.
 */

import db from './db';

/**
 * Updates codecPaths for existing tracks that don't have it set.
 * This migrates old tracks to use the new codec system.
 */
export async function migrateToCodecPaths() {
    console.log('Migrating tracks to use codecPaths...');

    // Find tracks without codecPaths
    const tracksToMigrate = await db.track.findMany({
        where: {
            codecPaths: null
        }
    });

    console.log(`Found ${tracksToMigrate.length} tracks needing migration.`);

    for (const track of tracksToMigrate) {
        try {
            // Determine codec from file extension
            const ext = track.filePath.toLowerCase();
            let codec = 'aac-legacy';
            if (ext.endsWith('.mp3')) codec = 'mp3';
            else if (ext.endsWith('.flac')) codec = 'alac';
            else if (ext.endsWith('.m4a')) codec = 'aac-legacy';
            else if (ext.endsWith('.wav')) codec = 'wav';

            await db.track.update({
                where: { id: track.id },
                data: {
                    codecPaths: JSON.stringify({ [codec]: track.filePath })
                }
            });
        } catch (error) {
            console.error(`Failed to migrate track ${track.title}:`, error);
        }
    }

    console.log('Migration complete.');
}

// Backward compatibility export (no-op)
export async function convertLibrary() {
    console.log('MP3 conversion is deprecated. Use multi-codec download settings instead.');
    await migrateToCodecPaths();
}
