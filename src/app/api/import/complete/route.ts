import { NextResponse } from 'next/server';
import db from '@/lib/db';

// Metadata type from gamdl service
interface TrackMetadata {
    title: string;
    artist: string;
    album: string;
    albumArtist?: string;
    duration?: number;
    trackNumber?: number;
    trackTotal?: number;
    discNumber?: number;
    discTotal?: number;
    genre?: string;
    composer?: string;
    comment?: string;
    copyright?: string;
    rating?: number;
    isGapless?: boolean;
    isCompilation?: boolean;
    releaseDate?: string;
    lyrics?: string;
    appleMusicId?: string;
    albumAppleMusicId?: string;
    storefront?: string;
    titleSort?: string;
    artistSort?: string;
    albumSort?: string;
    composerSort?: string;
    // Extended Apple Music metadata for albums
    description?: string;
    recordLabel?: string;
    upc?: string;
    isSingle?: boolean;
    isMasteredForItunes?: boolean;
    artworkBgColor?: string;
    artworkTextColor1?: string;
    artworkTextColor2?: string;
    artworkTextColor3?: string;
    artworkTextColor4?: string;
    // Lyrics metadata
    audioLocale?: string;
    lyricsHasWordSync?: boolean;
    lyricsTranslations?: string;
    lyricsPronunciations?: string;
    artistId?: string; // Apple Music Artist ID
}

interface TrackCompleteEvent {
    filePath: string;
    codecPaths?: Record<string, string>; // {"aac-legacy": "/path", "alac": "/path"}
    lyricsPath?: string;
    coverPath?: string;
    metadata: TrackMetadata;
    current?: number;
    total?: number;
}

// Helper to upsert artist, album, track into database
async function insertTrackToLibrary(event: TrackCompleteEvent): Promise<{ albumId: string; artistId: string; trackId: string }> {
    const { filePath, lyricsPath, coverPath, metadata } = event;

    // 1. Resolve Artist
    const artistName = metadata.albumArtist || metadata.artist || 'Unknown Artist';
    console.log(`[InsertTrack] Resolving artist: "${artistName}" (albumArtist: "${metadata.albumArtist}", artist: "${metadata.artist}")`);
    let artist = null;

    // Attempt to find artist by Apple Music ID first (most reliable)
    if (metadata.artistId) {
        artist = await db.artist.findUnique({ where: { appleMusicId: metadata.artistId } });
        if (artist) console.log(`[InsertTrack] Found artist by Apple Music ID: ${artist.id} (${artist.name})`);
    }

    if (!artist) {
        // Fallback: Upsert by Name.
        // Since we checked ID above and didn't find it, it's safe to set the ID here (no unique conflict).
        // (Unless concurrent requests introduce race condition, but unlikely in this context)
        artist = await db.artist.upsert({
            where: { name: artistName },
            create: {
                name: artistName,
                sortName: metadata.artistSort || null,
                appleMusicId: metadata.artistId || null
            },
            update: {
                sortName: metadata.artistSort || undefined,
                // Only update ID if we are sure? Yes, data enrichment.
                appleMusicId: metadata.artistId || undefined
            }
        });
        console.log(`[InsertTrack] Upserted artist by name: ${artist.id} (${artist.name})`);
    }

    // 2. Resolve Album
    const albumTitle = metadata.album || 'Unknown Album';
    console.log(`[InsertTrack] Resolving album: "${albumTitle}" for artist ${artist.id}`);
    let album = null;

    // Attempt to find album by Apple Music ID first
    if (metadata.albumAppleMusicId) {
        album = await db.album.findUnique({ where: { appleMusicId: metadata.albumAppleMusicId } });
        if (album) console.log(`[InsertTrack] Found album by Apple Music ID: ${album.id} (${album.title})`);
    }

    if (album) {
        // Found by ID. Update metadata on this specific album.
        album = await db.album.update({
            where: { id: album.id },
            data: {
                genre: metadata.genre || undefined,
                releaseDate: metadata.releaseDate ? new Date(metadata.releaseDate) : undefined,
                trackTotal: metadata.trackTotal || undefined,
                // coverImage: coverPath || undefined, // Field does not exist
                description: metadata.description || undefined,
                artworkBgColor: metadata.artworkBgColor || undefined,
                // We keep title and artistId as is to preserve user/library integrity
                // or we could force update them if we trust the metadata fully.
                // For now, assume ID match implies correct record.
            }
        });
    } else {
        // Not found by ID. Try upsert by Title + Artist.
        // Safe to set ID because we verified it's unused.
        album = await db.album.upsert({
            where: {
                title_artistId: {
                    title: albumTitle,
                    artistId: artist.id
                }
            },
            create: {
                title: albumTitle,
                artistId: artist.id,
                appleMusicId: metadata.albumAppleMusicId || null,
                genre: metadata.genre || null,
                releaseDate: metadata.releaseDate ? new Date(metadata.releaseDate) : null,
                copyright: metadata.copyright || null,
                trackTotal: metadata.trackTotal || null,
                discTotal: metadata.discTotal || null,
                recordLabel: metadata.recordLabel || null,
                upc: metadata.upc || null,
                isSingle: metadata.isSingle || false,
                // coverImage: coverPath || null, // Field does not exist in Album model
                description: metadata.description || null,
                artworkBgColor: metadata.artworkBgColor || null,
                artworkTextColor1: metadata.artworkTextColor1 || null,
                artworkTextColor2: metadata.artworkTextColor2 || null,
                artworkTextColor3: metadata.artworkTextColor3 || null,
                artworkTextColor4: metadata.artworkTextColor4 || null,
            },
            update: {
                // Update metadata if available
                genre: metadata.genre || undefined,
                releaseDate: metadata.releaseDate ? new Date(metadata.releaseDate) : undefined,
                trackTotal: metadata.trackTotal || undefined,
                // coverImage: coverPath || undefined, // Field does not exist
                description: metadata.description || undefined,
                artworkBgColor: metadata.artworkBgColor || undefined,
                appleMusicId: metadata.albumAppleMusicId || undefined
            }
        });
    }

    // 3. Upsert Track
    // Check if we already have this track (by Apple Music ID) but with a different file path
    let existingTrack = null;
    if (metadata.appleMusicId) {
        existingTrack = await db.track.findFirst({
            where: { appleMusicId: metadata.appleMusicId }
        });
    }

    let track;
    if (existingTrack) {
        // Merge codecPaths
        let mergedCodecPaths = {};
        try {
            if (existingTrack.codecPaths) {
                mergedCodecPaths = { ...JSON.parse(existingTrack.codecPaths) };
            }
            if (event.codecPaths) {
                mergedCodecPaths = { ...mergedCodecPaths, ...event.codecPaths };
            }
        } catch (e) {
            console.error("Error merging codecPaths:", e);
        }

        // Check for filePath unique constraint collision
        // If another track (phantom/duplicate) already has this filePath, delete it to allow the update
        const collidingTrack = await db.track.findUnique({
            where: { filePath }
        });

        if (collidingTrack && collidingTrack.id !== existingTrack.id) {
            console.log(`[Import] Deleting colliding track ${collidingTrack.id} to allow update of ${existingTrack.id}`);
            await db.track.delete({
                where: { id: collidingTrack.id }
            });
        }

        // Update the EXISTING track, potentially changing its main filePath to the new one
        // and updating metadata. We keep the ID stable.
        track = await db.track.update({
            where: { id: existingTrack.id },
            data: {
                title: metadata.title || undefined,
                artistId: artist.id, // Update artist/album link if changed
                albumId: album.id,
                filePath, // Update to the new file path (assuming new download is preferred)
                codecPaths: Object.keys(mergedCodecPaths).length > 0 ? JSON.stringify(mergedCodecPaths) : null,
                duration: metadata.duration || undefined,
                trackNumber: metadata.trackNumber || undefined,
                trackTotal: metadata.trackTotal || undefined,
                discNumber: metadata.discNumber || undefined,
                discTotal: metadata.discTotal || undefined,
                genre: metadata.genre || undefined,
                lyricsPath: lyricsPath || undefined, // Update lyrics path
                storefront: metadata.storefront || undefined,
                audioLocale: metadata.audioLocale || undefined,
                lyricsHasWordSync: metadata.lyricsHasWordSync || undefined,
            }
        });
    } else {
        // Normal upsert by filePath if no existing track found by ID
        track = await db.track.upsert({
            where: { filePath },
            create: {
                title: metadata.title,
                artistId: artist.id,
                albumId: album.id,
                filePath,
                codecPaths: event.codecPaths ? JSON.stringify(event.codecPaths) : null,
                duration: metadata.duration || 0,
                trackNumber: metadata.trackNumber || 1,
                trackTotal: metadata.trackTotal || 1,
                discNumber: metadata.discNumber || 1,
                discTotal: metadata.discTotal || 1,
                genre: metadata.genre,
                lyricsPath: lyricsPath || null,
                appleMusicId: metadata.appleMusicId || null,
                storefront: metadata.storefront || null,
                audioLocale: metadata.audioLocale || null,
                lyricsHasWordSync: metadata.lyricsHasWordSync || false,
                // isFavorite: false, // does not exist
                // playCount: 0 // does not exist
            },
            update: {
                // Re-import: update all metadata fields
                title: metadata.title,
                artistId: artist.id,
                albumId: album.id,
                codecPaths: event.codecPaths ? JSON.stringify(event.codecPaths) : undefined,
                duration: metadata.duration || undefined,
                trackNumber: metadata.trackNumber || undefined,
                trackTotal: metadata.trackTotal || undefined,
                discNumber: metadata.discNumber || undefined,
                discTotal: metadata.discTotal || undefined,
                genre: metadata.genre || undefined,
                appleMusicId: metadata.appleMusicId || undefined,
                storefront: metadata.storefront || undefined,
                audioLocale: metadata.audioLocale || undefined,
                lyricsPath: lyricsPath || undefined,
                lyricsHasWordSync: metadata.lyricsHasWordSync || undefined,
            }
        });
    }

    return { albumId: album.id, artistId: artist.id, trackId: track.id };
}

export async function POST(req: Request) {
    try {
        const body = await req.json();

        // Debug: log received body to trace metadata
        console.log('[ImportComplete] Received body:', JSON.stringify({
            filePath: body.filePath,
            hasMetadata: !!body.metadata,
            metadataArtist: body.metadata?.artist,
            metadataAlbum: body.metadata?.album,
            metadataTitle: body.metadata?.title,
            jobId: body.jobId,
            current: body.current,
            total: body.total
        }, null, 2));

        // Basic validation
        if (!body.filePath || !body.metadata) {
            console.log('[ImportComplete] VALIDATION FAILED - filePath:', !!body.filePath, 'metadata:', !!body.metadata);
            return NextResponse.json({ error: 'Missing required fields: filePath, metadata' }, { status: 400 });
        }

        console.log(`[ImportComplete] Received completion for: ${body.metadata?.title}`);

        const result = await insertTrackToLibrary(body as TrackCompleteEvent);

        // Update Import Job status if jobId is provided
        const jobId = (body as any).jobId;
        if (jobId) {
            const current = (body as any).current || 1;
            const total = (body as any).total || 1;
            const isFinished = current >= total;

            try {
                await db.importJob.update({
                    where: { id: jobId },
                    data: {
                        status: isFinished ? 'complete' : 'downloading',
                        progress: Math.floor((current / total) * 100),
                        tracksComplete: current,
                        tracksTotal: total, // Fix: also save total tracks count
                        importedAlbumId: result.albumId, // Link outcome
                        importedArtistId: result.artistId
                    }
                });
            } catch (jobErr) {
                console.error("Failed to update import job:", jobErr);
            }
        }

        return NextResponse.json({ success: true, ...result });
    } catch (error) {
        console.error("Import complete error:", error);
        return NextResponse.json({ error: String(error) }, { status: 500 });
    }
}
