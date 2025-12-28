"use client"

import * as React from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

interface CoverTrack {
    id: string
    albumId: string
}

interface PlaylistCoverProps {
    tracks: CoverTrack[]
    playlistName: string
    className?: string
}

/**
 * Playlist cover mosaic component that displays up to 4 unique album covers
 * in an S-pattern: top-left → top-right → bottom-right → bottom-left
 * 
 * Pattern with 1 cover: fills all 4 quadrants
 * Pattern with 2 covers: cover1 top-left & top-right, cover2 bottom-right & bottom-left
 * Pattern with 3 covers: cover1 TL, cover2 TR, cover3 BR, cover3 BL
 * Pattern with 4+ covers: each quadrant gets a unique cover
 */
export function PlaylistCover({ tracks, playlistName, className }: PlaylistCoverProps) {
    const [loadedImages, setLoadedImages] = React.useState<Set<string>>(new Set())

    // Get unique album IDs (first occurrence of each album)
    const uniqueAlbumTracks = React.useMemo(() => {
        const seenAlbums = new Set<string>()
        const unique: CoverTrack[] = []

        for (const track of tracks) {
            if (!seenAlbums.has(track.albumId)) {
                seenAlbums.add(track.albumId)
                unique.push(track)
                if (unique.length >= 4) break
            }
        }

        return unique
    }, [tracks])

    const handleImageLoad = (trackId: string) => {
        setLoadedImages(prev => new Set(prev).add(trackId))
    }

    // S-pattern positions: TL(0), TR(1), BR(2), BL(3)
    const getTrackForPosition = (position: number): CoverTrack | null => {
        const count = uniqueAlbumTracks.length

        if (count === 0) return null

        if (count === 1) {
            // Single cover fills all quadrants
            return uniqueAlbumTracks[0]
        }

        if (count === 2) {
            // First cover: TL, TR; Second cover: BR, BL
            if (position <= 1) return uniqueAlbumTracks[0]
            return uniqueAlbumTracks[1]
        }

        if (count === 3) {
            // S-pattern: TL=0, TR=1, BR=2, BL=2 (repeat last)
            if (position === 3) return uniqueAlbumTracks[2]
            return uniqueAlbumTracks[position]
        }

        // 4+ covers: each position gets its own
        return uniqueAlbumTracks[position] || null
    }

    // Position styles for the 4 quadrants
    const positions = [
        "top-0 left-0",     // Top-left (0)
        "top-0 right-0",    // Top-right (1)
        "bottom-0 right-0", // Bottom-right (2)
        "bottom-0 left-0",  // Bottom-left (3)
    ]

    if (uniqueAlbumTracks.length === 0) {
        // Empty playlist - show gradient with music note
        return (
            <div className={cn(
                "relative rounded-lg overflow-hidden shadow-2xl bg-gradient-to-br from-primary/30 to-primary/60",
                className
            )}>
                <div className="absolute inset-0 flex items-center justify-center text-primary-foreground font-bold text-6xl">
                    ♪
                </div>
            </div>
        )
    }

    return (
        <div className={cn(
            "relative rounded-lg overflow-hidden shadow-2xl",
            className
        )}>
            {/* 2x2 grid of cover images */}
            {positions.map((posClass, index) => {
                const track = getTrackForPosition(index)
                if (!track) return null

                const isLoaded = loadedImages.has(`${index}-${track.id}`)

                return (
                    <div
                        key={`${index}-${track.id}`}
                        className={cn(
                            "absolute w-1/2 h-1/2",
                            posClass
                        )}
                    >
                        {!isLoaded && (
                            <Skeleton className="absolute inset-0 w-full h-full bg-primary/10" />
                        )}
                        <img
                            src={`/api/cover/${track.id}?size=medium`}
                            alt={`Cover ${index + 1}`}
                            className={cn(
                                "w-full h-full object-cover transition-opacity duration-300",
                                isLoaded ? "opacity-100" : "opacity-0"
                            )}
                            onLoad={() => handleImageLoad(`${index}-${track.id}`)}
                            onError={(e) => {
                                e.currentTarget.style.display = 'none'
                            }}
                        />
                        {/* Fallback gradient for failed loads */}
                        <div className={cn(
                            "absolute inset-0 bg-gradient-to-br from-primary/20 to-primary/40 -z-10",
                            index === 1 && "from-primary/30 to-primary/50",
                            index === 2 && "from-primary/40 to-primary/60",
                            index === 3 && "from-primary/25 to-primary/45"
                        )} />
                    </div>
                )
            })}
        </div>
    )
}
