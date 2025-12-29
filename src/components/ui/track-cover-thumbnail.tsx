"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { AudioWaveform } from "@/components/ui/audio-waveform"
import { Play, Pause } from "lucide-react"
import { extractColorsFromImage } from "@/lib/color-extraction"

interface TrackCoverThumbnailProps {
    trackId: string
    isPlaying: boolean
    isPaused: boolean
    onPlayPauseClick: (e: React.MouseEvent) => void
    className?: string
}

// Cache for extracted colors to avoid re-extracting
const colorCache = new Map<string, string>()

/**
 * Check if a hex color is dark (needs light overlay) or light (needs dark overlay)
 * Returns true if the color is dark
 */
function isColorDark(hexColor: string): boolean {
    // Remove # if present
    const hex = hexColor.replace('#', '')

    // Parse RGB values
    const r = parseInt(hex.substring(0, 2), 16)
    const g = parseInt(hex.substring(2, 4), 16)
    const b = parseInt(hex.substring(4, 6), 16)

    // Calculate relative luminance (0-255 scale)
    // Using perceived luminance formula
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b)

    // Colors below this threshold are considered dark
    return luminance < 120
}

/**
 * Track cover thumbnail with playing state overlay.
 * Shows album art and animated waveform when playing,
 * with bars colored to match the album's predominant color.
 */
export function TrackCoverThumbnail({
    trackId,
    isPlaying,
    isPaused,
    onPlayPauseClick,
    className,
}: TrackCoverThumbnailProps) {
    const [dominantColor, setDominantColor] = React.useState<string | null>(null)
    const [imageLoaded, setImageLoaded] = React.useState(false)
    const coverUrl = `/api/cover/${trackId}?size=small`

    // Extract color from cover art
    React.useEffect(() => {
        // Check cache first
        const cached = colorCache.get(trackId)
        if (cached) {
            setDominantColor(cached)
            return
        }

        // Extract colors
        extractColorsFromImage(coverUrl).then((colors) => {
            if (colors.length > 0) {
                const color = colors[0]
                colorCache.set(trackId, color)
                setDominantColor(color)
            }
        })
    }, [trackId, coverUrl])

    const isCurrentTrack = isPlaying || isPaused

    // Determine overlay color based on dominant color brightness
    const needsLightOverlay = dominantColor ? isColorDark(dominantColor) : false
    const overlayClass = needsLightOverlay ? "bg-white/70" : "bg-black/70"
    const hoverOverlayClass = needsLightOverlay ? "bg-white/60" : "bg-black/60"

    return (
        <div
            className={cn(
                "relative w-12 h-12 rounded-md overflow-hidden flex-shrink-0 group/cover",
                className
            )}
        >
            {/* Cover art */}
            <img
                src={coverUrl}
                alt="Cover"
                className={cn(
                    "absolute inset-0 w-full h-full object-cover transition-opacity duration-200",
                    imageLoaded ? "opacity-100" : "opacity-0"
                )}
                onLoad={() => setImageLoaded(true)}
                onError={(e) => {
                    e.currentTarget.style.display = 'none'
                }}
            />

            {/* Fallback background */}
            <div className="absolute inset-0 bg-muted -z-10" />

            {/* Playing overlay - darkened/lightened cover with waveform */}
            {isPlaying && (
                <div className={cn("absolute inset-0 flex items-center justify-center group-hover/cover:hidden", overlayClass)}>
                    <AudioWaveform
                        size={20}
                        barCount={3}
                        color={dominantColor || undefined}
                    />
                </div>
            )}

            {/* Paused overlay - with pause icon */}
            {isPaused && (
                <div className={cn("absolute inset-0 flex items-center justify-center group-hover/cover:hidden", overlayClass)}>
                    <Pause
                        className="h-5 w-5"
                        style={{ color: dominantColor || 'hsl(var(--primary))' }}
                        fill="currentColor"
                    />
                </div>
            )}

            {/* Hover overlay for current track - shows play/pause button */}
            {isCurrentTrack && (
                <div
                    className={cn("absolute inset-0 hidden group-hover/cover:flex items-center justify-center cursor-pointer", overlayClass)}
                    onClick={onPlayPauseClick}
                >
                    {isPlaying ? (
                        <Pause className={cn("h-5 w-5 fill-current", needsLightOverlay ? "text-black" : "text-white")} />
                    ) : (
                        <Play className={cn("h-5 w-5 fill-current", needsLightOverlay ? "text-black" : "text-white")} />
                    )}
                </div>
            )}

            {/* Hover overlay for non-current tracks - shows play button */}
            {!isCurrentTrack && (
                <div className={cn("absolute inset-0 hidden group-hover/cover:flex items-center justify-center", hoverOverlayClass)}>
                    <Play className={cn("h-5 w-5 fill-current", needsLightOverlay ? "text-black" : "text-white")} />
                </div>
            )}
        </div>
    )
}


