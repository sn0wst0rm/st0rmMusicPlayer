import { NextResponse } from 'next/server';
import db from '@/lib/db';

const GAMDL_SERVICE_URL = process.env.GAMDL_SERVICE_URL || 'http://127.0.0.1:5100';

interface RouteParams {
    params: Promise<{ jobId: string }>;
}

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
}

interface TrackCompleteEvent {
    filePath: string;
    codecPaths?: Record<string, string>; // {"aac-legacy": "/path", "alac": "/path"}
    lyricsPath?: string;
    coverPath?: string;
    animatedCoverPath?: string;
    animatedCoverSmallPath?: string;
    metadata: TrackMetadata;
    current: number;
    total: number;
}

// Helper to upsert artist, album, track into database
async function insertTrackToLibrary(event: TrackCompleteEvent): Promise<{ albumId: string; artistId: string; trackId: string }> {
    const { filePath, lyricsPath, coverPath, animatedCoverPath, animatedCoverSmallPath, metadata } = event;

    // 1. Upsert Artist
    const artistName = metadata.albumArtist || metadata.artist || 'Unknown Artist';
    const artist = await db.artist.upsert({
        where: { name: artistName },
        create: {
            name: artistName,
            sortName: metadata.artistSort || null,
            appleMusicId: null // We don't have artist Apple Music ID in track metadata
        },
        update: {
            sortName: metadata.artistSort || undefined
        }
    });

    // 2. Upsert Album
    const albumTitle = metadata.album || 'Unknown Album';
    const album = await db.album.upsert({
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
            isCompilation: metadata.isCompilation || false,
            sortTitle: metadata.albumSort || null,
            // Set cover paths if available
            coverLargePath: coverPath || null,
            // Extended Apple Music metadata
            description: metadata.description || null,
            recordLabel: metadata.recordLabel || null,
            upc: metadata.upc || null,
            isSingle: metadata.isSingle || false,
            isMasteredForItunes: metadata.isMasteredForItunes || false,
            artworkBgColor: metadata.artworkBgColor || null,
            artworkTextColor1: metadata.artworkTextColor1 || null,
            artworkTextColor2: metadata.artworkTextColor2 || null,
            artworkTextColor3: metadata.artworkTextColor3 || null,
            artworkTextColor4: metadata.artworkTextColor4 || null,
            animatedCoverPath: animatedCoverPath || null,
            animatedCoverSmallPath: animatedCoverSmallPath || null
        },
        update: {
            appleMusicId: metadata.albumAppleMusicId || undefined,
            genre: metadata.genre || undefined,
            releaseDate: metadata.releaseDate ? new Date(metadata.releaseDate) : undefined,
            copyright: metadata.copyright || undefined,
            trackTotal: metadata.trackTotal || undefined,
            discTotal: metadata.discTotal || undefined,
            isCompilation: metadata.isCompilation || undefined,
            sortTitle: metadata.albumSort || undefined,
            coverLargePath: coverPath || undefined,
            // Extended Apple Music metadata
            description: metadata.description || undefined,
            recordLabel: metadata.recordLabel || undefined,
            upc: metadata.upc || undefined,
            isSingle: metadata.isSingle !== undefined ? metadata.isSingle : undefined,
            isMasteredForItunes: metadata.isMasteredForItunes !== undefined ? metadata.isMasteredForItunes : undefined,
            artworkBgColor: metadata.artworkBgColor || undefined,
            artworkTextColor1: metadata.artworkTextColor1 || undefined,
            artworkTextColor2: metadata.artworkTextColor2 || undefined,
            artworkTextColor3: metadata.artworkTextColor3 || undefined,
            artworkTextColor4: metadata.artworkTextColor4 || undefined,
            animatedCoverPath: animatedCoverPath || undefined,
            animatedCoverSmallPath: animatedCoverSmallPath || undefined
        }
    });

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
                composer: metadata.composer || undefined,
                comment: metadata.comment || undefined,
                copyright: metadata.copyright || undefined,
                rating: metadata.rating || undefined,
                isGapless: metadata.isGapless || undefined,
                lyricsPath: lyricsPath || undefined,
                lyrics: metadata.lyrics || undefined,
                // appleMusicId is already same
                storefront: metadata.storefront || undefined,
                titleSort: metadata.titleSort || undefined,
                artistSort: metadata.artistSort || undefined,
                albumSort: metadata.albumSort || undefined,
                composerSort: metadata.composerSort || undefined,
                // Lyrics availability
                audioLocale: metadata.audioLocale || undefined,
                lyricsHasWordSync: metadata.lyricsHasWordSync !== undefined ? metadata.lyricsHasWordSync : undefined,
                lyricsTranslations: metadata.lyricsTranslations || undefined,
                lyricsPronunciations: metadata.lyricsPronunciations || undefined
            }
        });
    } else {
        // Normal upsert by filePath if no existing track found by ID
        track = await db.track.upsert({
            where: { filePath },
            create: {
                title: metadata.title || 'Unknown Track',
                artistId: artist.id,
                albumId: album.id,
                filePath,
                codecPaths: event.codecPaths ? JSON.stringify(event.codecPaths) : null,
                duration: metadata.duration || null,
                trackNumber: metadata.trackNumber || null,
                trackTotal: metadata.trackTotal || null,
                discNumber: metadata.discNumber || null,
                discTotal: metadata.discTotal || null,
                genre: metadata.genre || null,
                composer: metadata.composer || null,
                comment: metadata.comment || null,
                copyright: metadata.copyright || null,
                rating: metadata.rating || null,
                isGapless: metadata.isGapless || null,
                lyricsPath: lyricsPath || null,
                lyrics: metadata.lyrics || null,
                appleMusicId: metadata.appleMusicId || null,
                storefront: metadata.storefront || null,
                titleSort: metadata.titleSort || null,
                artistSort: metadata.artistSort || null,
                albumSort: metadata.albumSort || null,
                composerSort: metadata.composerSort || null,
                // Lyrics availability
                audioLocale: metadata.audioLocale || null,
                lyricsHasWordSync: metadata.lyricsHasWordSync || false,
                lyricsTranslations: metadata.lyricsTranslations || null,
                lyricsPronunciations: metadata.lyricsPronunciations || null
            },
            update: {
                title: metadata.title || undefined,
                codecPaths: event.codecPaths ? JSON.stringify(event.codecPaths) : undefined,
                duration: metadata.duration || undefined,
                trackNumber: metadata.trackNumber || undefined,
                trackTotal: metadata.trackTotal || undefined,
                discNumber: metadata.discNumber || undefined,
                discTotal: metadata.discTotal || undefined,
                genre: metadata.genre || undefined,
                composer: metadata.composer || undefined,
                comment: metadata.comment || undefined,
                copyright: metadata.copyright || undefined,
                rating: metadata.rating || undefined,
                isGapless: metadata.isGapless || undefined,
                lyricsPath: lyricsPath || undefined,
                lyrics: metadata.lyrics || undefined,
                appleMusicId: metadata.appleMusicId || undefined,
                storefront: metadata.storefront || undefined,
                titleSort: metadata.titleSort || undefined,
                artistSort: metadata.artistSort || undefined,
                albumSort: metadata.albumSort || undefined,
                composerSort: metadata.composerSort || undefined,
                // Lyrics availability
                audioLocale: metadata.audioLocale || undefined,
                lyricsHasWordSync: metadata.lyricsHasWordSync !== undefined ? metadata.lyricsHasWordSync : undefined,
                lyricsTranslations: metadata.lyricsTranslations || undefined,
                lyricsPronunciations: metadata.lyricsPronunciations || undefined
            }
        });
    }

    return { albumId: album.id, artistId: artist.id, trackId: track.id };
}

// GET stream download status via SSE
export async function GET(request: Request, { params }: RouteParams) {
    const { jobId } = await params;

    // Get job from database
    const job = await db.importJob.findUnique({
        where: { id: jobId }
    });

    if (!job) {
        return NextResponse.json(
            { error: 'Job not found' },
            { status: 404 }
        );
    }

    // Get settings for cookies
    const settings = await db.gamdlSettings.findUnique({
        where: { id: 'singleton' }
    });

    if (!settings?.cookies) {
        return NextResponse.json(
            { error: 'Cookies not configured' },
            { status: 400 }
        );
    }

    // Create SSE stream
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            const sendEvent = (event: string, data: unknown) => {
                controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
            };

            let controllerClosed = false;

            try {
                // Update job status to downloading
                await db.importJob.update({
                    where: { id: jobId },
                    data: { status: 'downloading' }
                });

                sendEvent('started', { jobId, status: 'downloading' });

                // Call Python service for download
                console.log('[DEBUG] Calling Python download service for job:', jobId);
                console.log('[DEBUG] URL:', job.url);
                console.log('[DEBUG] Service URL:', `${GAMDL_SERVICE_URL}/download`);

                const downloadRes = await fetch(`${GAMDL_SERVICE_URL}/download`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        url: job.url,
                        cookies: settings.cookies,
                        output_path: settings.mediaLibraryPath,
                        // Use job-specific codecs if provided, otherwise fall back to settings
                        song_codecs: job.selectedCodecs || settings.songCodecs || 'aac-legacy',
                        lyrics_format: settings.lyricsFormat,
                        cover_size: settings.coverSize,
                        save_cover: settings.saveCover,
                        language: settings.language,
                        overwrite: settings.overwrite,
                        lyrics_translation_langs: settings.lyricsTranslationLangs || '',
                        lyrics_pronunciation_langs: settings.lyricsPronunciationLangs || ''
                    })
                });

                console.log('[DEBUG] Download service response status:', downloadRes.status);

                if (!downloadRes.ok) {
                    const errText = await downloadRes.text();
                    console.error('[DEBUG] Download service error:', errText);
                    throw new Error(`Download service error: ${downloadRes.status} - ${errText}`);
                }

                // Stream SSE from Python service
                const reader = downloadRes.body?.getReader();
                if (!reader) {
                    throw new Error('No response body from download service');
                }

                const decoder = new TextDecoder();
                let buffer = '';
                let tracksComplete = 0;
                let totalTracks = 0;
                const _importedTrackIds: string[] = []; // Track IDs for playlist linking (TODO: implement)
                let playlistId: string | null = null;

                // If this is a playlist import, create or find the playlist first
                if (job.type === 'playlist') {
                    let appleMusicPlaylistId: string | null = null;
                    try {
                        // Extract Apple Music playlist ID from URL
                        // Supports: p.xxx (Library) and pl.xxx (Global)
                        const urlMatch = job.url.match(/\/playlist\/(?:[^/]+\/)?((?:pl|p)\.[a-zA-Z0-9-]+)/);
                        appleMusicPlaylistId = urlMatch ? urlMatch[1] : null;

                        // Get globalId from job (passed from validation)
                        const globalId = job.globalId;

                        console.log(`[DEBUG] Extracted Playlist ID: ${appleMusicPlaylistId}, GlobalId: ${globalId} from ${job.url}`);

                        // Check if playlist already exists by BOTH appleMusicId AND globalId
                        // This handles the case where library (p.xxx) and catalog (pl.u-xxx) URLs are different for same playlist
                        let existingPlaylist = null;

                        if (appleMusicPlaylistId) {
                            existingPlaylist = await db.playlist.findUnique({
                                where: { appleMusicId: appleMusicPlaylistId }
                            });
                        }

                        // If not found by appleMusicId, check by globalId
                        if (!existingPlaylist && globalId) {
                            existingPlaylist = await db.playlist.findUnique({
                                where: { globalId: globalId }
                            });
                        }

                        if (existingPlaylist) {
                            console.log(`[DEBUG] Playlist already exists: ${existingPlaylist.id}`);
                            // Playlist already exists - delete the job to avoid history clutter
                            await db.importJob.delete({
                                where: { id: jobId }
                            });

                            sendEvent('already_exists', {
                                playlistId: existingPlaylist.id,
                                playlistName: existingPlaylist.name,
                                message: `Playlist "${existingPlaylist.name}" has already been imported`
                            });
                            sendEvent('complete', { completed: 0, total: 0, alreadyExists: true });
                            controllerClosed = true;
                            controller.close();
                            return;
                        }

                        const playlist = await db.playlist.create({
                            data: {
                                name: job.title,
                                description: job.description,
                                appleMusicId: appleMusicPlaylistId,
                                globalId: globalId, // Store globalId for cross-URL duplicate detection
                                artworkUrl: job.artworkUrl,
                                isSynced: true,
                                lastSyncedAt: new Date(),
                            }
                        });
                        playlistId = playlist.id;

                        // Update job with playlist reference
                        await db.importJob.update({
                            where: { id: jobId },
                            data: { importedPlaylistId: playlistId }
                        });

                        console.log(`[DEBUG] Created playlist: ${playlist.id} - ${playlist.name}`);
                    } catch (err) {
                        console.error('[ERROR] Failed to handle playlist creation:', err);

                        // Attempt to recover: if creation failed (likely unique constraint), try to find it again
                        if (appleMusicPlaylistId) {
                            try {
                                const recoveredPlaylist = await db.playlist.findUnique({
                                    where: { appleMusicId: appleMusicPlaylistId }
                                });

                                if (recoveredPlaylist) {
                                    console.log(`[DEBUG] Recovered playlist from error: ${recoveredPlaylist.id}`);
                                    playlistId = recoveredPlaylist.id;

                                    await db.importJob.update({
                                        where: { id: jobId },
                                        data: { importedPlaylistId: playlistId }
                                    });
                                }
                            } catch (recoveryErr) {
                                console.error('[ERROR] Failed to recover playlist:', recoveryErr);
                            }
                        }
                    }
                }

                console.log('[SSE] Starting to read SSE stream...');
                let currentEventType = '';

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) {
                        console.log('[SSE] Stream ended (done=true)');
                        break;
                    }

                    const chunk = decoder.decode(value, { stream: true });
                    console.log(`[SSE] Received chunk (${chunk.length} chars):`, chunk.substring(0, 100));
                    buffer += chunk;
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || ''; // Keep incomplete line in buffer

                    for (const line of lines) {
                        if (line.startsWith('event:')) {
                            currentEventType = line.substring(6).trim();
                            console.log(`[SSE] Received event type: ${currentEventType}`);
                            continue;
                        }

                        if (line.startsWith('data:')) {
                            try {
                                const data = JSON.parse(line.substring(5).trim());
                                console.log(`[SSE] Received data for event '${currentEventType}':`, JSON.stringify(data).substring(0, 200));

                                // Handle different event types based on currentEventType
                                if (currentEventType === 'queue_ready' && data.total_tracks !== undefined) {
                                    totalTracks = data.total_tracks;
                                    await db.importJob.update({
                                        where: { id: jobId },
                                        data: { tracksTotal: totalTracks }
                                    });
                                    sendEvent('queue_ready', { totalTracks });
                                }

                                if (currentEventType === 'track_complete') {
                                    console.log('[SSE] Processing track_complete event:', {
                                        hasFilePath: !!data.filePath,
                                        hasMetadata: !!data.metadata,
                                        filePath: data.filePath,
                                        metadata: data.metadata
                                    });

                                    if (data.filePath && data.metadata) {
                                        // Track completed - insert into library
                                        const { albumId, artistId, trackId } = await insertTrackToLibrary(data as TrackCompleteEvent);
                                        tracksComplete++;

                                        // If this is a playlist import, add track to playlist
                                        if (playlistId && trackId) {
                                            await db.playlistTrack.create({
                                                data: {
                                                    playlistId,
                                                    trackId,
                                                    position: tracksComplete // Use order of download as position
                                                }
                                            });
                                            console.log(`[DEBUG] Added track ${trackId} to playlist ${playlistId} at position ${tracksComplete}`);
                                        }

                                        await db.importJob.update({
                                            where: { id: jobId },
                                            data: {
                                                tracksComplete,
                                                progress: totalTracks > 0
                                                    ? Math.round((tracksComplete / totalTracks) * 100)
                                                    : 0,
                                                // Store imported IDs for navigation (last one wins)
                                                importedAlbumId: albumId,
                                                importedArtistId: artistId
                                            }
                                        });

                                        sendEvent('track_complete', {
                                            current: tracksComplete,
                                            total: totalTracks,
                                            title: data.metadata.title,
                                            artist: data.metadata.artist
                                        });
                                    }
                                }

                                if (currentEventType === 'complete' || data.status === 'success') {
                                    // Get the updated job with imported IDs
                                    const updatedJob = await db.importJob.update({
                                        where: { id: jobId },
                                        data: { status: 'complete', progress: 100 }
                                    });
                                    sendEvent('complete', {
                                        completed: tracksComplete,
                                        total: totalTracks,
                                        importedAlbumId: updatedJob.importedAlbumId,
                                        importedPlaylistId: updatedJob.importedPlaylistId || playlistId,
                                        type: job.type
                                    });
                                }

                                if (currentEventType === 'track_starting' && data.percent !== undefined) {
                                    sendEvent('progress', data);
                                }

                                if (currentEventType === 'error' && data.message) {
                                    throw new Error(data.message);
                                }

                                // Reset event type after processing data
                                currentEventType = '';
                            } catch (parseError) {
                                // Ignore parse errors for incomplete data, but rethrow actual errors
                                if (parseError instanceof Error && parseError.message !== 'Unexpected end of JSON input') {
                                    throw parseError;
                                }
                            }
                        }
                    }
                }
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';

                await db.importJob.update({
                    where: { id: jobId },
                    data: { status: 'error', error: errorMessage }
                });

                sendEvent('error', { message: errorMessage });
            } finally {
                if (!controllerClosed) {
                    controller.close();
                }
            }
        }
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        }
    });
}
