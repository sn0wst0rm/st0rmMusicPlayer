"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

interface AudioWaveformProps {
    className?: string
    barCount?: number
    size?: number // Size in pixels (width and height will be equal)
}

/**
 * Animated audio waveform visualizer with bouncing bars
 * Used to indicate a track is currently playing
 * The component is perfectly squared (width = height)
 */
export function AudioWaveform({ className, barCount = 3, size = 16 }: AudioWaveformProps) {
    // Generate pseudo-random but stable animation parameters for each bar
    // Using different prime-based durations and delays for organic feel
    const bars = React.useMemo(() => {
        const durations = [1.35, 1.8, 1.2] // Slower durations for smooth animation
        const delays = [0, 0.3, 0.15] // Staggered delays

        return Array.from({ length: barCount }).map((_, i) => ({
            duration: durations[i % durations.length],
            delay: delays[i % delays.length]
        }))
    }, [barCount])

    return (
        <div
            className={cn("flex items-end justify-center gap-0.5", className)}
            style={{ width: size, height: size }}
        >
            {bars.map((bar, i) => (
                <div
                    key={i}
                    className="bg-primary rounded-sm animate-waveform-random"
                    style={{
                        width: 3,
                        height: size, // Full height, animation will scale it
                        animationDuration: `${bar.duration}s`,
                        animationDelay: `${bar.delay}s`,
                    }}
                />
            ))}
        </div>
    )
}
