"use client"

import * as React from "react"
import { usePlayerStore } from "@/lib/store"
import { Slider } from "@/components/ui/slider"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { DynamicGradientBackground } from "@/components/ui/dynamic-gradient-background"
import { extractColorsFromImage, getAppleMusicFallbackColors } from "@/lib/color-extraction"
import { Play, Pause, SkipBack, SkipForward, Volume2, Shuffle, ListVideo, Repeat, Repeat1 } from "lucide-react"
import { cn } from "@/lib/utils"

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
        library,
        setSelectedAlbum
    } = usePlayerStore()

    const audioRef = React.useRef<HTMLAudioElement>(null)
    const [progress, setProgress] = React.useState(0)
    const [duration, setDuration] = React.useState(0)
    const [isCoverLoaded, setIsCoverLoaded] = React.useState(false)
    const [gradientColors, setGradientColors] = React.useState<string[]>(getAppleMusicFallbackColors())

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
            setProgress(audioRef.current.currentTime)
            setDuration(audioRef.current.duration || 0)
        }
    }

    const handleEnded = () => {
        nextTrack()
    }

    const handleSeek = (value: number[]) => {
        if (audioRef.current) {
            audioRef.current.currentTime = value[0]
            setProgress(value[0])
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
                    <div className="w-full max-w-sm flex items-center gap-2 text-xs text-muted-foreground font-variant-numeric tabular-nums">
                        <span>{formatTime(progress)}</span>
                        <Slider
                            value={[progress]}
                            max={duration || 100}
                            step={1}
                            onValueChange={handleSeek}
                            className="w-full"
                        />
                        <span>{formatTime(duration)}</span>
                    </div>
                </div>

                {/* Volume */}
                <div className="flex items-center justify-end gap-2 w-1/3">
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
