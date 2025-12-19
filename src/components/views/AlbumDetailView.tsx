"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { AudioWaveform } from "@/components/ui/audio-waveform"
import { Play, Shuffle, ChevronLeft, Pause, ListPlus, Plus } from "lucide-react"
import { cn } from "@/lib/utils"
import { usePlayerStore, Track, SelectedAlbum } from "@/lib/store"

interface AlbumDetailViewProps {
    album: SelectedAlbum
    onBack: () => void
    onArtistClick?: () => void
}

function formatDuration(seconds: number) {
    if (!seconds) return "0:00"
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
}

function formatTotalDuration(tracks: Track[]) {
    const totalSeconds = tracks.reduce((acc, track) => acc + (track.duration || 0), 0)
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    if (hours > 0) {
        return `${hours} hr ${minutes} min`
    }
    return `${minutes} min`
}

export function AlbumDetailView({ album, onBack, onArtistClick }: AlbumDetailViewProps) {
    const { playTrack, currentTrack, isPlaying, setIsPlaying, playNext, addToQueue } = usePlayerStore()
    const [isCoverLoaded, setIsCoverLoaded] = React.useState(false)

    // Prepare tracks with metadata for playback
    const tracksWithMetadata = React.useMemo(() => {
        return album.tracks.map(track => ({
            ...track,
            artist: { name: album.artistName },
            album: { title: album.title }
        }))
    }, [album])

    const handlePlayAlbum = () => {
        if (tracksWithMetadata.length > 0) {
            playTrack(tracksWithMetadata[0], tracksWithMetadata)
        }
    }

    const handleShuffleAlbum = () => {
        if (tracksWithMetadata.length > 0) {
            const shuffled = [...tracksWithMetadata].sort(() => Math.random() - 0.5)
            playTrack(shuffled[0], shuffled)
        }
    }

    const handlePlayTrack = (track: Track, index: number) => {
        playTrack(tracksWithMetadata[index], tracksWithMetadata)
    }

    const isCurrentTrackPlaying = (trackId: string) => {
        return currentTrack?.id === trackId && isPlaying
    }

    const isCurrentTrack = (trackId: string) => {
        return currentTrack?.id === trackId
    }

    return (
        <div className="h-full w-full overflow-auto">
            {/* Back button - mt-14 positions it below header initially, sticky top-14 keeps it there when scrolling */}
            <div className="sticky top-14 mt-14 z-30 bg-background/60 backdrop-blur-md border-b transition-colors supports-[backdrop-filter]:bg-background/60">
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={onBack}
                    className="m-2 gap-1 text-muted-foreground hover:text-foreground"
                >
                    <ChevronLeft className="h-4 w-4" />
                    Back
                </Button>
            </div>

            {/* Main content - pt-8 gives space below back button bar */}
            <div className="max-w-4xl mx-auto px-8 pt-8 pb-32">
                {/* Album Header */}
                <div className="flex flex-col md:flex-row gap-8 mb-8">
                    {/* Cover Art */}
                    <div className="w-64 h-64 md:w-72 md:h-72 flex-shrink-0 mx-auto md:mx-0 relative rounded-lg overflow-hidden shadow-2xl group">
                        {!isCoverLoaded && (
                            <Skeleton className="absolute inset-0 w-full h-full bg-primary/10" />
                        )}
                        <img
                            src={album.tracks[0] ? `/api/cover/${album.tracks[0].id}?size=large` : ""}
                            alt={album.title}
                            className={cn(
                                "absolute inset-0 w-full h-full object-cover transition-opacity duration-300",
                                isCoverLoaded ? "opacity-100" : "opacity-0"
                            )}
                            onLoad={() => setIsCoverLoaded(true)}
                            onError={(e) => {
                                e.currentTarget.style.display = 'none'
                            }}
                        />
                        {/* Fallback */}
                        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-gray-200 to-gray-300 dark:from-gray-800 dark:to-gray-900 text-muted-foreground font-bold text-6xl -z-10">
                            {album.title.charAt(0)}
                        </div>
                    </div>

                    {/* Album Info */}
                    <div className="flex flex-col justify-end text-center md:text-left">
                        <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-1">Album</p>
                        <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-2">{album.title}</h1>
                        <p
                            className="text-xl text-primary hover:underline cursor-pointer mb-4"
                            onClick={onArtistClick}
                        >
                            {album.artistName}
                        </p>
                        <p className="text-sm text-muted-foreground mb-6">
                            {album.tracks.length} {album.tracks.length === 1 ? 'song' : 'songs'} • {formatTotalDuration(album.tracks)}
                        </p>

                        {/* Action Buttons - matching Add Folder button style */}
                        <div className="flex gap-3 justify-center md:justify-start">
                            <Button
                                size="sm"
                                onClick={handlePlayAlbum}
                                className="px-6 gap-2"
                            >
                                <Play className="h-4 w-4 fill-current" />
                                Play
                            </Button>
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={handleShuffleAlbum}
                                className="px-6 gap-2"
                            >
                                <Shuffle className="h-4 w-4" />
                                Shuffle
                            </Button>
                        </div>
                    </div>
                </div>

                {/* Track List */}
                <div className="rounded-xl overflow-hidden border bg-card/50 backdrop-blur-sm">
                    {tracksWithMetadata.map((track, index) => (
                        <div
                            key={track.id}
                            onClick={() => handlePlayTrack(track, index)}
                            className={cn(
                                "flex items-center gap-4 px-4 py-3 hover:bg-muted/50 cursor-pointer transition-colors group",
                                index !== tracksWithMetadata.length - 1 && "border-b border-border/50",
                                isCurrentTrack(track.id) && "bg-primary/10 hover:bg-primary/15"
                            )}
                        >
                            {/* Track Number / Play Button / Waveform */}
                            <div className="w-8 h-8 flex items-center justify-center flex-shrink-0">
                                {isCurrentTrackPlaying(track.id) ? (
                                    // Currently playing: show waveform, pause on hover
                                    <div className="relative h-8 w-8 flex items-center justify-center">
                                        <AudioWaveform className="group-hover:hidden" />
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 text-primary hidden group-hover:flex"
                                            onClick={(e) => {
                                                e.stopPropagation()
                                                setIsPlaying(false)
                                            }}
                                        >
                                            <Pause className="h-4 w-4 fill-current" />
                                        </Button>
                                    </div>
                                ) : isCurrentTrack(track.id) ? (
                                    // Current track but paused: show pause icon, play on hover
                                    <div className="relative h-8 w-8 flex items-center justify-center">
                                        <Pause className="h-4 w-4 fill-primary text-primary group-hover:hidden" />
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 text-primary hidden group-hover:flex"
                                            onClick={(e) => {
                                                e.stopPropagation()
                                                setIsPlaying(true)
                                            }}
                                        >
                                            <Play className="h-4 w-4 fill-current" />
                                        </Button>
                                    </div>
                                ) : (
                                    // Not current track: show number, filled play on hover
                                    <>
                                        <span className="text-muted-foreground text-sm group-hover:hidden">
                                            {index + 1}
                                        </span>
                                        <Play className="h-4 w-4 text-primary fill-primary hidden group-hover:block" />
                                    </>
                                )}
                            </div>

                            {/* Track Title */}
                            <div className="flex-1 min-w-0">
                                <p className={cn(
                                    "font-medium truncate",
                                    isCurrentTrack(track.id) && "text-primary"
                                )}>
                                    {track.title}
                                </p>
                            </div>

                            {/* Queue actions - show on hover */}
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                    title="Play Next"
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        playNext(track)
                                    }}
                                >
                                    <ListPlus className="h-4 w-4" />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                    title="Add to Queue"
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        addToQueue(track)
                                    }}
                                >
                                    <Plus className="h-4 w-4" />
                                </Button>
                            </div>

                            {/* Duration */}
                            <span className="text-sm text-muted-foreground tabular-nums">
                                {formatDuration(track.duration)}
                            </span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    )
}
