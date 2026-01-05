"use client"

import * as React from "react"
import { usePlayerStore } from "@/lib/store"
import { Slider } from "@/components/ui/slider"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { DynamicGradientBackground } from "@/components/ui/dynamic-gradient-background"
import { extractColorsFromImage, getAppleMusicFallbackColors } from "@/lib/color-extraction"
import { Play, Pause, SkipBack, SkipForward, Volume2, Shuffle, ListVideo, Repeat, Repeat1, Mic2, Headphones } from "lucide-react"
import { cn } from "@/lib/utils"
import { CodecSelector } from "@/components/codec-selector"
import { getSpatialAudioRenderer, isSpatialCodec, detectSpatialAudioSupport } from "@/lib/spatial-audio"

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
        fetchCodecsForTrack
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
    const preloadAudioRef = React.useRef<HTMLAudioElement | null>(null)

    // Spatial audio state
    const [spatialEnabled, setSpatialEnabled] = React.useState(false)
    const [headTrackingEnabled, setHeadTrackingEnabled] = React.useState(false)
    const [spatialSupported, setSpatialSupported] = React.useState(false)
    const spatialRendererRef = React.useRef<ReturnType<typeof getSpatialAudioRenderer> | null>(null)

    React.useEffect(() => {
        setIsCoverLoaded(false)
    }, [currentTrack])

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
    }, [currentTrack])

    // Fetch available codecs when track changes
    React.useEffect(() => {
        if (currentTrack?.id) {
            fetchCodecsForTrack(currentTrack.id)
        }
    }, [currentTrack?.id, fetchCodecsForTrack])

    // Check spatial audio support on mount
    React.useEffect(() => {
        const support = detectSpatialAudioSupport()
        setSpatialSupported(support.webAudioSupported && support.pannerSupported)
    }, [])

    // Initialize/cleanup spatial audio based on codec
    React.useEffect(() => {
        const isSpatial = isSpatialCodec(currentCodec)

        if (isSpatial && audioRef.current && !spatialRendererRef.current) {
            // Initialize spatial audio for spatial codecs
            const renderer = getSpatialAudioRenderer()
            renderer.initialize(audioRef.current).then(success => {
                if (success) {
                    spatialRendererRef.current = renderer
                    setSpatialEnabled(true)
                }
            })
        } else if (!isSpatial && spatialRendererRef.current) {
            // Cleanup spatial audio when switching away from spatial codec
            spatialRendererRef.current.destroy()
            spatialRendererRef.current = null
            setSpatialEnabled(false)
            setHeadTrackingEnabled(false)
        }

        return () => {
            // Cleanup on unmount
            if (spatialRendererRef.current) {
                spatialRendererRef.current.destroy()
                spatialRendererRef.current = null
            }
        }
    }, [currentCodec])

    // Toggle head tracking
    const toggleHeadTracking = async () => {
        if (!spatialRendererRef.current) return

        if (headTrackingEnabled) {
            spatialRendererRef.current.disableHeadTracking()
            setHeadTrackingEnabled(false)
        } else {
            const success = await spatialRendererRef.current.enableHeadTracking()
            setHeadTrackingEnabled(success)
        }
    }

    React.useEffect(() => {
        if (audioRef.current) {
            if (isPlaying) {
                audioRef.current.play().catch(e => console.error("Play failed", e))
            } else {
                audioRef.current.pause()
            }
        }
    }, [isPlaying, currentTrack])

    React.useEffect(() => {
        if (audioRef.current) {
            audioRef.current.volume = volume
        }
    }, [volume])

    React.useEffect(() => {
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
        }
    }, [currentTrack])

    React.useEffect(() => {
        if ("mediaSession" in navigator) {
            navigator.mediaSession.setActionHandler("play", () => setIsPlaying(true))
            navigator.mediaSession.setActionHandler("pause", () => setIsPlaying(false))
            navigator.mediaSession.setActionHandler("seekbackward", (details) => {
                if (audioRef.current) {
                    audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - (details.seekOffset || 10))
                }
            })
            navigator.mediaSession.setActionHandler("seekforward", (details) => {
                if (audioRef.current) {
                    audioRef.current.currentTime = Math.min(audioRef.current.duration, audioRef.current.currentTime + (details.seekOffset || 10))
                }
            })
            // Removed prev/next handlers to restore system seeker controls as requested
        }
    }, [setIsPlaying, prevTrack, nextTrack])

    const handleTimeUpdate = () => {
        if (audioRef.current) {
            const currentTime = audioRef.current.currentTime
            setProgress(currentTime)
            setDuration(audioRef.current.duration || 0)

            // Save progress to store every 5 seconds (throttled)
            if (Math.abs(currentTime - lastSavedProgressRef.current) >= 5) {
                setPlaybackProgress(currentTime)
                lastSavedProgressRef.current = currentTime
            }
        }
    }

    // Restore playback position after page reload (runs once)
    React.useEffect(() => {
        if (hasRestoredRef.current) return
        if (audioRef.current && currentTrack && playbackProgress > 0) {
            // Wait for audio to be ready before seeking
            const handleCanPlay = () => {
                if (audioRef.current && playbackProgress > 0 && !hasRestoredRef.current) {
                    audioRef.current.currentTime = playbackProgress
                    setProgress(playbackProgress)
                    hasRestoredRef.current = true
                    // Don't auto-play, just position - user must click play
                }
            }
            audioRef.current.addEventListener('canplay', handleCanPlay, { once: true })
            return () => {
                audioRef.current?.removeEventListener('canplay', handleCanPlay)
            }
        }
    }, [currentTrack, playbackProgress])

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
    }, [currentTrack, setPlaybackProgress])

    const handleEnded = () => {
        nextTrack()
    }

    const handleSeek = (value: number[]) => {
        if (audioRef.current) {
            audioRef.current.currentTime = value[0]
            setProgress(value[0])
        }
    }

    // Smooth codec switching with crossfade
    const handleCodecChange = async (newCodec: string) => {
        if (!currentTrack || !audioRef.current || isCodecSwitching) return
        if (newCodec === currentCodec) return

        setIsCodecSwitching(true)
        const currentTime = audioRef.current.currentTime
        const wasPlaying = isPlaying
        const currentVolume = audioRef.current.volume

        try {
            // Create new audio element for preloading
            const newStreamUrl = `/api/stream/${currentTrack.id}?codec=${newCodec}`
            const newAudio = new Audio(newStreamUrl)
            newAudio.volume = 0
            newAudio.currentTime = currentTime
            preloadAudioRef.current = newAudio

            // Wait for new audio to be ready
            await new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('Timeout')), 10000)
                newAudio.addEventListener('canplay', () => {
                    clearTimeout(timeout)
                    resolve()
                }, { once: true })
                newAudio.addEventListener('error', () => {
                    clearTimeout(timeout)
                    reject(new Error('Load failed'))
                }, { once: true })
                newAudio.load()
            })

            // Sync position more precisely
            newAudio.currentTime = audioRef.current.currentTime

            // Quick crossfade (200ms)
            const fadeDuration = 200
            const fadeSteps = 20
            const fadeInterval = fadeDuration / fadeSteps

            if (wasPlaying) {
                newAudio.play().catch(() => { })
            }

            // Fade out old, fade in new
            for (let i = 0; i <= fadeSteps; i++) {
                await new Promise(r => setTimeout(r, fadeInterval))
                if (audioRef.current) {
                    audioRef.current.volume = currentVolume * (1 - i / fadeSteps)
                }
                newAudio.volume = currentVolume * (i / fadeSteps)
            }

            // Pause old audio
            audioRef.current.pause()

            // Update codec state
            setCurrentCodec(newCodec)

            // Save preference to server
            fetch(`/api/track/${currentTrack.id}/codecs`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ codec: newCodec })
            }).catch(() => { })

        } catch (error) {
            console.error('Codec switch failed:', error)
            // Restore volume on failure
            if (audioRef.current) {
                audioRef.current.volume = currentVolume
            }
        } finally {
            setIsCodecSwitching(false)
            preloadAudioRef.current = null
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

    // Construct stream URL
    // If we have an ID, we use the stream endpoint
    const streamUrl = `/api/stream/${currentTrack.id}`

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
                        <img
                            src={currentTrack ? `/api/cover/${currentTrack.id}?size=small` : ""}
                            alt={currentTrack?.title || "Cover"}
                            className={cn("h-full w-full object-cover transition-opacity duration-300", !isCoverLoaded && "opacity-0")}
                            onLoad={() => setIsCoverLoaded(true)}
                            onError={(e) => {
                                e.currentTarget.style.display = "none";
                                // setIsCoverLoaded(true); // Keep skeleton on error as requested
                            }}
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
                            value={[progress]}
                            max={duration || 100}
                            step={1}
                            onValueChange={handleSeek}
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
                    {/* Spatial Audio / Head Tracking Toggle */}
                    {spatialSupported && isSpatialCodec(currentCodec) && (
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={toggleHeadTracking}
                            className={cn(
                                "hover:text-primary relative",
                                headTrackingEnabled && "text-blue-400"
                            )}
                            title={headTrackingEnabled ? "Disable Head Tracking" : "Enable Head Tracking (Spatial Audio)"}
                        >
                            <Headphones className="h-4 w-4" />
                            {headTrackingEnabled && (
                                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-blue-400 rounded-full animate-pulse" />
                            )}
                        </Button>
                    )}
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
