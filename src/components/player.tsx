"use client"

import * as React from "react"
import { usePlayerStore } from "@/lib/store"
import { Slider } from "@/components/ui/slider"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { DynamicGradientBackground } from "@/components/ui/dynamic-gradient-background"
import { extractColorsFromImage, getAppleMusicFallbackColors } from "@/lib/color-extraction"
import { Play, Pause, SkipBack, SkipForward, Volume2, Shuffle, ListVideo, Repeat, Repeat1, Mic2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { CodecSelector } from "@/components/codec-selector"
import { isCodecSupportedInBrowser } from "@/lib/browser-codec-support"

export function Player() {
    const {
        currentTrack,
        isPlaying,
        volume,
        setIsPlaying,
        setVolume,
        nextTrack,
        prevTrack,
        toggleShuffle,
        isShuffling,
        repeatMode,
        toggleRepeat,
        sessionHistory,
        setQueueOpen,
        queueOpen,
        lyricsOpen,
        toggleLyrics,
        library,
        setSelectedAlbum,
        playbackProgress,
        setPlaybackProgress,
        currentCodec,
        availableCodecs,
        setCurrentCodec,
        fetchCodecsForTrack,
        queue,
    } = usePlayerStore()

    const audioRef = React.useRef<HTMLAudioElement>(null)
    const [progress, setProgress] = React.useState(0)
    const [duration, setDuration] = React.useState(0)
    const [isCoverLoaded, setIsCoverLoaded] = React.useState(false)
    const [showRemainingTime, setShowRemainingTime] = React.useState(false)
    const [gradientColors, setGradientColors] = React.useState<string[]>(getAppleMusicFallbackColors())
    const lastSavedProgressRef = React.useRef<number>(0)
    const hasRestoredRef = React.useRef<boolean>(false)
    const [isCodecSwitching, setIsCodecSwitching] = React.useState(false)
    // Track which track+codec combo is validated to prevent loading unvalidated codecs
    const [validatedState, setValidatedState] = React.useState<{ trackId: string; codec: string } | null>(null)
    const preloadAudioRef = React.useRef<HTMLAudioElement | null>(null)



    // Ref to track first render - skip track reset on initial mount for position restoration
    const isFirstRenderRef = React.useRef(true)

    // Download WebSocket handling has been moved to DownloadManager.tsx for better separation of concerns



    React.useEffect(() => {
        // Skip on initial mount to allow position restoration on page reload
        if (isFirstRenderRef.current) {
            isFirstRenderRef.current = false
            return
        }

        setIsCoverLoaded(false)
        // Reset progress and duration when track changes (but not on initial mount)
        setProgress(0)
        setDuration(0)
        // Reset saved progress tracking
        lastSavedProgressRef.current = 0
        // Reset validated state - forces re-validation for new track
        setValidatedState(null)
        // Stop and clear audio element to prevent old track from playing
        if (audioRef.current) {
            audioRef.current.pause()
            audioRef.current.removeAttribute('src')
            audioRef.current.load() // Force element to reset
            audioRef.current.currentTime = 0
        }
        // Reset hasRestored so we don't restore old position on new tracks
        hasRestoredRef.current = false
    }, [currentTrack?.id])

    // Extract colors from cover art when track changes
    React.useEffect(() => {
        if (!currentTrack) {
            setGradientColors(getAppleMusicFallbackColors())
            return
        }

        const coverUrl = `/api/cover/${currentTrack.id}?size=small`
        extractColorsFromImage(coverUrl)
            .then(colors => setGradientColors(colors))
            .catch(() => setGradientColors(getAppleMusicFallbackColors()))
    }, [currentTrack?.id])

    // Fetch available codecs when track changes
    React.useEffect(() => {
        if (currentTrack?.id) {
            fetchCodecsForTrack(currentTrack.id)
        }
    }, [currentTrack?.id, fetchCodecsForTrack])

    // Validate and auto-select best playable codec when track changes or availableCodecs load
    // Uses browser compatibility table - no per-track testing needed
    React.useEffect(() => {
        if (!currentTrack || availableCodecs.length === 0) return

        // Use ref to check if already validated - avoids infinite re-render loops
        // since ref changes don't trigger effects
        const alreadyValidated = validatedState?.trackId === currentTrack.id &&
            validatedState?.codec && availableCodecs.includes(validatedState.codec)

        if (alreadyValidated) {
            // If codec matches what we have, nothing to do
            if (validatedState.codec === currentCodec) {
                return
            }
            // If validated codec differs from current, update current to match
            setCurrentCodec(validatedState.codec)
            return
        }

        // Get codec priority from store
        const { codecPriority } = usePlayerStore.getState()

        // Find the best codec: must be available for track AND supported by browser
        let bestCodec: string | null = null

        // First try codecs in priority order
        for (const codec of codecPriority) {
            if (availableCodecs.includes(codec) && isCodecSupportedInBrowser(codec)) {
                bestCodec = codec
                break
            }
        }

        // Fallback to any available codec that browser supports
        if (!bestCodec) {
            for (const codec of availableCodecs) {
                if (isCodecSupportedInBrowser(codec)) {
                    bestCodec = codec
                    break
                }
            }
        }

        if (bestCodec) {
            // Set validated state and codec together to avoid race conditions
            setValidatedState({ trackId: currentTrack.id, codec: bestCodec })
            if (bestCodec !== currentCodec) {
                setCurrentCodec(bestCodec)
            }
        } else {
            // No playable codec found - show error
            import('sonner').then(({ toast }) => {
                toast.error('No compatible audio codec available', {
                    description: 'This track cannot be played in your browser. Try Safari for full codec support.'
                })
            })
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentTrack?.id, availableCodecs, setCurrentCodec])


    // Only control play/pause when codec is validated
    React.useEffect(() => {
        if (!audioRef.current) return

        // Only control playback when we have a validated codec for current track
        const isValid = validatedState?.trackId === currentTrack?.id &&
            validatedState?.codec === currentCodec
        if (!isValid) return

        if (isPlaying) {
            audioRef.current.play().catch(e => {
                if (e.name !== 'AbortError') {
                    console.error("Play failed", e)
                }
            })
        } else {
            audioRef.current.pause()
        }
    }, [isPlaying, validatedState, currentTrack?.id, currentCodec])

    React.useEffect(() => {
        if (audioRef.current) {
            audioRef.current.volume = volume
        }
    }, [volume])

    React.useEffect(() => {
        if ("mediaSession" in navigator && currentTrack) {
            // Use absolute URLs for artwork - required for iOS
            const baseUrl = typeof window !== 'undefined' ? window.location.origin : ''
            navigator.mediaSession.metadata = new MediaMetadata({
                title: currentTrack.title,
                artist: currentTrack.artist?.name || "Unknown Artist",
                album: currentTrack.album?.title || "Unknown Album",
                artwork: [
                    { src: `${baseUrl}/api/cover/${currentTrack.id}?size=small`, sizes: "96x96", type: "image/jpeg" },
                    { src: `${baseUrl}/api/cover/${currentTrack.id}?size=medium`, sizes: "256x256", type: "image/jpeg" },
                    { src: `${baseUrl}/api/cover/${currentTrack.id}?size=large`, sizes: "512x512", type: "image/jpeg" },
                ]
            })
        }
    }, [currentTrack?.id, currentTrack?.title, currentTrack?.artist?.name, currentTrack?.album?.title])

    React.useEffect(() => {
        if ("mediaSession" in navigator) {
            navigator.mediaSession.setActionHandler("play", () => setIsPlaying(true))
            navigator.mediaSession.setActionHandler("pause", () => setIsPlaying(false))

            // Match handlePrev logic: rewind if >3s into track, else go to previous
            navigator.mediaSession.setActionHandler("previoustrack", () => {
                if (audioRef.current && (audioRef.current.currentTime > 3 || sessionHistory.length === 0)) {
                    audioRef.current.currentTime = 0
                    setPlaybackProgress(0) // Reset saved progress
                } else {
                    setPlaybackProgress(0) // Reset so previous track starts from beginning
                    prevTrack()
                }
            })

            navigator.mediaSession.setActionHandler("nexttrack", () => nextTrack())

            // Seekbackward/seekforward needed for seek bar to work on iOS (shows -10/+10 buttons)
            navigator.mediaSession.setActionHandler("seekbackward", (details) => {
                if (audioRef.current) {
                    audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - (details.seekOffset || 10))
                }
            })
            navigator.mediaSession.setActionHandler("seekforward", (details) => {
                if (audioRef.current) {
                    audioRef.current.currentTime = Math.min(audioRef.current.duration || 0, audioRef.current.currentTime + (details.seekOffset || 10))
                }
            })

            // Seek bar works via seekto handler
            navigator.mediaSession.setActionHandler("seekto", (details) => {
                if (audioRef.current && details.seekTime !== undefined && isFinite(details.seekTime)) {
                    audioRef.current.currentTime = details.seekTime
                    // Update position state immediately for responsive seek bar
                    if (navigator.mediaSession.setPositionState && isFinite(audioRef.current.duration)) {
                        try {
                            navigator.mediaSession.setPositionState({
                                duration: audioRef.current.duration,
                                playbackRate: audioRef.current.playbackRate || 1,
                                position: details.seekTime
                            })
                        } catch (e) { /* ignore */ }
                    }
                }
            })
        }
    }, [setIsPlaying, prevTrack, nextTrack, sessionHistory.length, setPlaybackProgress])

    // Ref for throttling position state updates
    const lastPositionUpdateRef = React.useRef<number>(0)

    const handleTimeUpdate = () => {
        if (audioRef.current) {
            const currentTime = audioRef.current.currentTime
            const audioDuration = audioRef.current.duration

            // Guard against NaN/Infinity values
            if (isFinite(currentTime)) {
                setProgress(currentTime)
            }
            if (isFinite(audioDuration) && audioDuration > 0) {
                setDuration(audioDuration)

                // Update system media controls seek bar position (throttled to 1x per second)
                const now = Date.now()
                if ("mediaSession" in navigator && navigator.mediaSession.setPositionState && now - lastPositionUpdateRef.current > 1000) {
                    lastPositionUpdateRef.current = now
                    try {
                        navigator.mediaSession.setPositionState({
                            duration: audioDuration,
                            playbackRate: audioRef.current.playbackRate || 1,
                            position: currentTime
                        })
                    } catch (e) {
                        // Ignore errors from invalid position state
                    }
                }
            }

            // Save progress to store every 5 seconds (throttled)
            if (isFinite(currentTime) && Math.abs(currentTime - lastSavedProgressRef.current) >= 5) {
                setPlaybackProgress(currentTime)
                lastSavedProgressRef.current = currentTime
            }
        }
    }

    // Restore playback position ONLY on page reload (not on track change)
    // Track if this is the initial mount with a track from persisted state
    const isInitialMountRef = React.useRef(true)
    const initialTrackIdRef = React.useRef<string | null>(null)

    // Capture the initial track ID on first render with a track
    React.useEffect(() => {
        if (isInitialMountRef.current && currentTrack?.id && playbackProgress > 0) {
            initialTrackIdRef.current = currentTrack.id
        }
        // Mark as no longer initial mount after first track change
        if (currentTrack?.id && isInitialMountRef.current) {
            // Delay marking as non-initial to allow restoration effect to run
            const timer = setTimeout(() => {
                isInitialMountRef.current = false
            }, 100)
            return () => clearTimeout(timer)
        }
    }, [currentTrack?.id, playbackProgress])

    React.useEffect(() => {
        if (hasRestoredRef.current) return
        if (!audioRef.current || !currentTrack || playbackProgress <= 0) return

        // Only restore if we captured an initial track ID (page reload case)
        // and we're still on that same track
        if (!initialTrackIdRef.current) {
            return
        }

        if (initialTrackIdRef.current !== currentTrack.id) {
            hasRestoredRef.current = true
            return
        }

        // Check if codec is validated
        const isValid = validatedState?.trackId === currentTrack.id &&
            validatedState?.codec === currentCodec
        if (!isValid) {
            return
        }



        // Wait for audio to be ready before seeking
        const handleCanPlay = () => {
            if (audioRef.current && playbackProgress > 0 && !hasRestoredRef.current) {
                const dur = audioRef.current.duration
                // Only restore if position is valid and less than duration
                if (isFinite(dur) && playbackProgress < dur - 1) {
                    audioRef.current.currentTime = playbackProgress
                    setProgress(playbackProgress)
                }
                hasRestoredRef.current = true
            }
        }

        if (audioRef.current.readyState >= 3) {
            handleCanPlay()
        } else {
            audioRef.current.addEventListener('canplay', handleCanPlay, { once: true })
            return () => {
                audioRef.current?.removeEventListener('canplay', handleCanPlay)
            }
        }
    }, [currentTrack?.id, playbackProgress, validatedState, currentCodec])

    // Save progress on page unload
    React.useEffect(() => {
        const handleBeforeUnload = () => {
            if (audioRef.current && currentTrack) {
                setPlaybackProgress(audioRef.current.currentTime)
            }
        }
        window.addEventListener('beforeunload', handleBeforeUnload)
        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload)
        }
    }, [currentTrack?.id, setPlaybackProgress])

    const handleEnded = () => {
        nextTrack()
    }

    const handleSeek = React.useCallback((value: number[]) => {
        if (audioRef.current && duration > 0) {
            audioRef.current.currentTime = value[0]
            setProgress(value[0])
        }
    }, [duration])

    // Codec switching - updates audio source directly
    // This is for switching codec on the SAME track (preserves position)
    const handleCodecChange = async (newCodec: string) => {
        if (!currentTrack || !audioRef.current || isCodecSwitching) return
        if (newCodec === currentCodec) return

        setIsCodecSwitching(true)

        // Capture current state BEFORE any changes
        const wasPlaying = isPlaying
        const savedVolume = audioRef.current.volume
        const previousCodec = currentCodec

        try {
            // PRELOAD: Create hidden audio element to load new codec
            const preloadAudio = new Audio()
            preloadAudio.preload = 'auto'
            preloadAudio.volume = savedVolume
            preloadAudio.src = `/api/stream/${currentTrack.id}?codec=${newCodec}`

            // Wait for preload audio to be ready enough to play
            const preloadResult = await new Promise<'ready' | 'error' | 'timeout'>((resolve) => {
                const timeout = setTimeout(() => resolve('timeout'), 10000)

                const handleReady = () => {
                    clearTimeout(timeout)
                    cleanup()
                    resolve('ready')
                }

                const handleError = () => {
                    clearTimeout(timeout)
                    cleanup()
                    resolve('error')
                }

                const cleanup = () => {
                    preloadAudio.removeEventListener('canplaythrough', handleReady)
                    preloadAudio.removeEventListener('canplay', handleReady)
                    preloadAudio.removeEventListener('error', handleError)
                }

                // Wait for canplaythrough for smoother playback
                preloadAudio.addEventListener('canplaythrough', handleReady)
                preloadAudio.addEventListener('canplay', handleReady)
                preloadAudio.addEventListener('error', handleError)
                preloadAudio.load()
            })

            if (preloadResult === 'error') {
                // Show toast notification for unsupported codec
                const { toast } = await import('sonner')
                toast.error(`${newCodec.toUpperCase()} is not supported in this browser`, {
                    description: 'Try Safari for full codec support, or select a different format.'
                })
                preloadAudio.src = ''
                setIsCodecSwitching(false)
                return
            }

            // Preload successful - seek the preload audio to current position
            // Get exact time right before swap for accuracy  
            const exactTime = audioRef.current?.currentTime || 0

            if (isFinite(exactTime) && exactTime > 0 && isFinite(preloadAudio.duration)) {
                preloadAudio.currentTime = Math.min(exactTime, preloadAudio.duration - 0.5)
            }

            // Wait a brief moment for seek to complete on preload audio
            await new Promise(resolve => setTimeout(resolve, 100))

            // NOW do the instant swap - current audio is still playing until this point
            // Pause current playback
            audioRef.current.pause()

            // Update codec state - triggers re-render with new streamUrl
            setCurrentCodec(newCodec)
            setValidatedState({ trackId: currentTrack.id, codec: newCodec })

            // Wait for React to update the DOM with new src
            await new Promise(resolve => setTimeout(resolve, 10))

            // The audioRef now has the new src, load and play immediately
            if (audioRef.current) {
                audioRef.current.volume = savedVolume
                audioRef.current.load()

                // Set position after load starts
                audioRef.current.currentTime = preloadAudio.currentTime

                // Resume playback immediately if was playing
                // Browser will buffer as it plays since we already verified codec works
                if (wasPlaying && audioRef.current) {
                    await audioRef.current.play().catch(e => {
                        if (e.name !== 'AbortError') {
                            console.error('Playback failed after codec switch:', e)
                        }
                    })
                }

                // Re-register media session to fix controls
                if ("mediaSession" in navigator && currentTrack) {
                    navigator.mediaSession.metadata = new MediaMetadata({
                        title: currentTrack.title,
                        artist: currentTrack.artist?.name || "Unknown Artist",
                        album: currentTrack.album?.title || "Unknown Album",
                        artwork: [
                            { src: `/api/cover/${currentTrack.id}?size=small`, sizes: "96x96", type: "image/jpeg" },
                            { src: `/api/cover/${currentTrack.id}?size=medium`, sizes: "256x256", type: "image/jpeg" },
                            { src: `/api/cover/${currentTrack.id}?size=large`, sizes: "512x512", type: "image/jpeg" },
                        ]
                    })
                    navigator.mediaSession.playbackState = wasPlaying ? 'playing' : 'paused'
                }
            }

            // Cleanup preload audio
            preloadAudio.pause()
            preloadAudio.src = ''

            // Save preference to server
            fetch(`/api/track/${currentTrack.id}/codecs`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ codec: newCodec })
            }).catch(() => { })

        } catch (error) {
            console.error('Codec switch failed:', error)
            // Restore previous codec on failure
            if (previousCodec) {
                setCurrentCodec(previousCodec)
            }
        } finally {
            setIsCodecSwitching(false)
        }
    }

    const togglePlay = () => {
        setIsPlaying(!isPlaying)
    }

    const handlePrev = () => {
        // If track played > 3s OR no session history (single track/start of queue), rewind
        if (audioRef.current && (audioRef.current.currentTime > 3 || sessionHistory.length === 0)) {
            audioRef.current.currentTime = 0
        } else {
            prevTrack()
        }
    }

    if (!currentTrack) {
        return (
            <div className="h-20 border-t bg-background/60 backdrop-blur-3xl flex items-center justify-center text-muted-foreground text-sm fixed bottom-0 left-0 right-0 z-50">
                Select a song or an album to play
            </div>
        )
    }

    // Only allow audio to load when this exact track+codec combo is validated
    const isValidForPlayback = validatedState?.trackId === currentTrack.id &&
        validatedState?.codec === currentCodec

    // Construct stream URL with current codec - only set when validated
    const streamUrl = isValidForPlayback
        ? `/api/stream/${currentTrack.id}?codec=${currentCodec}`
        : undefined // Don't load until codec is validated

    return (
        <div className="h-20 border-t fixed bottom-0 left-0 right-0 z-50 shadow-lg overflow-hidden">
            {/* Animated gradient background */}
            <DynamicGradientBackground
                colors={gradientColors}
                className="absolute inset-0 opacity-50"
                isPaused={!isPlaying}
            />
            {/* Content overlay with slight blur for readability */}
            <div className="absolute inset-0 bg-background/50 backdrop-blur-sm" />
            {/* Player content */}
            <div className="relative h-full flex items-center px-4 justify-between">
                <audio
                    ref={audioRef}
                    src={streamUrl}
                    onTimeUpdate={handleTimeUpdate}
                    onEnded={handleEnded}
                    loop={repeatMode === 'one'}
                />

                {/* Track Info */}
                <div className="flex items-center gap-4 w-1/3 min-w-0">
                    <div className="h-12 w-12 bg-secondary rounded-md shadow-sm overflow-hidden flex-shrink-0 relative group">
                        {!isCoverLoaded && <Skeleton className="absolute inset-0 w-full h-full bg-primary/10" />}
                        <PlayerCoverImage
                            currentTrack={currentTrack}
                            library={library}
                            isCoverLoaded={isCoverLoaded}
                            setIsCoverLoaded={setIsCoverLoaded}
                        />
                        {!currentTrack && (
                            <div className="absolute inset-0 flex items-center justify-center bg-gray-200 dark:bg-gray-800 text-xs text-muted-foreground">
                                Music
                            </div>
                        )}
                    </div>
                    <div className="truncate">
                        <div className="font-medium truncate text-sm">{currentTrack.title}</div>
                        <div className="text-xs text-muted-foreground truncate">
                            {currentTrack.artist?.name || "Unknown Artist"} — <span
                                className="hover:underline cursor-pointer hover:text-foreground transition-colors"
                                onClick={() => {
                                    // Find the album from library
                                    if (!currentTrack.albumId) return
                                    for (const artist of library) {
                                        const album = artist.albums.find(a => a.id === currentTrack.albumId)
                                        if (album) {
                                            setSelectedAlbum({
                                                id: album.id,
                                                title: album.title,
                                                tracks: album.tracks,
                                                artistName: artist.name
                                            })
                                            return
                                        }
                                    }
                                }}
                            >{currentTrack.album?.title || "Unknown Album"}</span>
                        </div>
                        <CodecSelector
                            trackId={currentTrack.id}
                            currentCodec={currentCodec}
                            availableCodecs={availableCodecs}
                            onCodecChange={handleCodecChange}
                            isLoading={isCodecSwitching}
                        />
                    </div>
                </div>

                {/* Player Controls */}
                <div className="flex flex-col items-center gap-1 w-1/3">
                    <div className="flex items-center gap-6">
                        <Button variant="ghost" size="icon" onClick={toggleShuffle} className={cn("hover:text-primary", isShuffling && "text-primary")}>
                            <Shuffle className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={handlePrev} className="hover:text-primary">
                            <SkipBack className="h-5 w-5 fill-current" />
                        </Button>
                        <Button
                            size="icon"
                            className="h-12 w-12 rounded-full shadow-md bg-primary hover:bg-primary/90 hover:scale-105 transition-all"
                            onClick={togglePlay}
                        >
                            {isPlaying ? (
                                <Pause className="h-6 w-6 fill-current text-primary-foreground" />
                            ) : (
                                <Play className="h-6 w-6 fill-current text-primary-foreground" />
                            )}
                        </Button>
                        <Button variant="ghost" size="icon" onClick={nextTrack} className="hover:text-primary">
                            <SkipForward className="h-5 w-5 fill-current" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={toggleRepeat} className={cn("hover:text-primary", repeatMode !== 'off' && "text-primary")}>
                            {repeatMode === 'one' ? <Repeat1 className="h-4 w-4" /> : <Repeat className="h-4 w-4" />}
                        </Button>
                    </div>
                    <div className="w-full max-w-sm flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
                        <span
                            className="min-w-[32px] text-right"
                            style={{ textShadow: '0 1px 2px rgba(0,0,0,0.15)' }}
                        >
                            {formatTime(progress)}
                        </span>
                        <Slider
                            value={[Number.isFinite(progress) && Number.isFinite(duration) && duration > 0 ? Math.min(progress, duration) : 0]}
                            max={Number.isFinite(duration) && duration > 0 ? duration : 1}
                            step={1}
                            onValueChange={Number.isFinite(duration) && duration > 0 ? handleSeek : undefined}
                            className="w-full"
                        />
                        <span
                            className="min-w-[32px] cursor-pointer hover:text-foreground transition-colors"
                            style={{ textShadow: '0 1px 2px rgba(0,0,0,0.15)' }}
                            onClick={() => setShowRemainingTime(!showRemainingTime)}
                            title={showRemainingTime ? "Show total time" : "Show remaining time"}
                        >
                            {showRemainingTime ? `-${formatTime(duration - progress)}` : formatTime(duration)}
                        </span>
                    </div>
                </div>

                {/* Volume */}
                <div className="flex items-center justify-end gap-2 w-1/3">

                    <Button variant="ghost" size="icon" onClick={toggleLyrics} className={cn("hover:text-primary", lyricsOpen && "text-primary")}>
                        <Mic2 className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => setQueueOpen(!queueOpen)} className={cn("hover:text-primary", queueOpen && "text-primary")}>
                        <ListVideo className="h-4 w-4" />
                    </Button>
                    <div className="w-px h-8 bg-border mx-2" /> {/* Divider */}
                    <Volume2 className="h-4 w-4 text-muted-foreground" />
                    <Slider
                        value={[volume]}
                        max={1}
                        step={0.01}
                        onValueChange={(v) => setVolume(v[0])}
                        className="w-24"
                    />
                </div>
            </div>
        </div>
    )
}

function formatTime(seconds: number) {
    if (!seconds || isNaN(seconds)) return "0:00"
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, "0")}`
}

function PlayerCoverImage({ currentTrack, library, isCoverLoaded, setIsCoverLoaded }: {
    currentTrack: any,
    library: any[],
    isCoverLoaded: boolean,
    setIsCoverLoaded: (loaded: boolean) => void
}) {
    const [activeSrc, setActiveSrc] = React.useState<string>("");

    // Compute paths
    const staticCoverPath = currentTrack?.id ? `/api/cover/${currentTrack.id}?size=small` : "";

    const animatedCoverPath = React.useMemo(() => {
        if (!currentTrack?.albumId) return null;
        for (const artist of library) {
            const album = artist.albums.find((a: any) => a.id === currentTrack.albumId);
            if (album?.animatedCoverPath) {
                return album.animatedCoverPath;
            }
        }
        return null;
    }, [library, currentTrack?.albumId]);

    // Effect to handle loading strategy
    React.useEffect(() => {
        if (!currentTrack) {
            setActiveSrc("");
            return;
        }

        // Always start/reset to static cover immediately when track changes
        // This ensures prompt feedback
        setActiveSrc(staticCoverPath);

        // If we have an animated path, try to pre-load it
        if (animatedCoverPath && currentTrack.albumId) {
            const animatedSrc = `/api/animated-cover/${currentTrack.albumId}?size=small`;

            const img = new Image();
            img.src = animatedSrc;
            img.onload = () => {
                // Only switch if this is still the relevant track/cover
                // (Closure captures the scope, but good to be reactive if we used extensive refs, 
                // but here effectively if the component unmounts/updates dependencies this effect cleans up implicitely by being superseded)
                // Actually to be safe we can check if we are still mounted or just rely on react state update stability.
                // React state updates on unmounted components are warned but generally safe-ish, 
                // but let's assume standard behavior.
                setActiveSrc(animatedSrc);
                console.log('[PlayerCoverImage] Switched to animated cover');
            };
            img.onerror = () => {
                console.warn('[PlayerCoverImage] Failed to load animated cover, staying on static');
            };
        }
    }, [currentTrack?.id, animatedCoverPath, staticCoverPath]);

    return (
        <img
            // Key changes only when track changes, not when upgrading to animated
            // This allows the browser to potentially crossfade or just replace content smoothly
            // actually, changing src without key change is standard.
            // But we might want to trigger fade loop?
            // Simple src swap is fine for now.
            key={currentTrack?.id || "empty"}
            src={activeSrc || staticCoverPath} // Fallback to static if active is empty
            alt={currentTrack?.title || "Cover"}
            className={cn("h-full w-full object-cover transition-opacity duration-300", !isCoverLoaded && "opacity-0")}
            onLoad={() => setIsCoverLoaded(true)}
            onError={(e) => {
                // Ultimate fallback if even static fails
                e.currentTarget.style.display = "none";
            }}
        />
    );
}
