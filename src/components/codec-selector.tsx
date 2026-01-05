"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ChevronDown, Waves } from "lucide-react"

// Codec display names and descriptions
const CODEC_INFO: Record<string, { label: string; shortLabel: string; category: 'standard' | 'hires' | 'spatial' }> = {
    'aac-legacy': { label: 'AAC 256kbps', shortLabel: 'AAC', category: 'standard' },
    'aac-he-legacy': { label: 'AAC-HE 64kbps', shortLabel: 'AAC-HE', category: 'standard' },
    'aac': { label: 'AAC (48kHz)', shortLabel: 'AAC', category: 'standard' },
    'aac-he': { label: 'AAC-HE', shortLabel: 'AAC-HE', category: 'standard' },
    'alac': { label: 'Lossless', shortLabel: 'Lossless', category: 'hires' },
    'atmos': { label: 'Dolby Atmos', shortLabel: 'Atmos', category: 'spatial' },
    'aac-binaural': { label: 'Spatial Audio', shortLabel: 'Spatial', category: 'spatial' },
    'aac-downmix': { label: 'Downmix', shortLabel: 'Downmix', category: 'standard' },
    'ac3': { label: 'AC3 Surround', shortLabel: 'AC3', category: 'spatial' },
}

interface CodecSelectorProps {
    trackId: string
    currentCodec: string | null
    availableCodecs: string[]
    onCodecChange: (codec: string) => void
    className?: string
    isLoading?: boolean
}

export function CodecSelector({
    trackId,
    currentCodec,
    availableCodecs,
    onCodecChange,
    className,
    isLoading
}: CodecSelectorProps) {
    // Determine the display codec
    const displayCodec = currentCodec || availableCodecs[0] || 'aac-legacy'
    const info = CODEC_INFO[displayCodec] || { shortLabel: displayCodec.toUpperCase(), label: displayCodec, category: 'standard' }

    // If only one codec (or none), show a non-interactive badge
    if (availableCodecs.length <= 1 && !isLoading) {
        return (
            <div className={cn(
                "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium",
                info.category === 'hires' && "bg-gradient-to-r from-purple-500/20 to-pink-500/20 text-purple-600 dark:text-purple-300",
                info.category === 'spatial' && "bg-gradient-to-r from-blue-500/20 to-cyan-500/20 text-blue-600 dark:text-blue-300",
                info.category === 'standard' && "bg-muted/50 text-muted-foreground",
                className
            )}>
                <Waves className="h-3 w-3" />
                {info.shortLabel}
            </div>
        )
    }

    const currentInfo = CODEC_INFO[currentCodec || 'aac-legacy'] || { shortLabel: currentCodec || 'AAC', label: currentCodec || 'AAC', category: 'standard' }

    return (
        <DropdownMenu>
            <DropdownMenuTrigger
                className={cn(
                    "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium transition-all",
                    "hover:bg-white/10 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/50",
                    currentInfo.category === 'hires' && "bg-gradient-to-r from-purple-500/20 to-pink-500/20 text-purple-600 dark:text-purple-300",
                    currentInfo.category === 'spatial' && "bg-gradient-to-r from-blue-500/20 to-cyan-500/20 text-blue-600 dark:text-blue-300",
                    currentInfo.category === 'standard' && "bg-white/10 text-white/80",
                    className
                )}
                disabled={isLoading}
            >
                <Waves className="h-3 w-3" />
                {currentInfo.shortLabel}
                <ChevronDown className="h-3 w-3 opacity-60" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[160px]">
                {availableCodecs.map((codec) => {
                    const info = CODEC_INFO[codec] || { label: codec.toUpperCase(), shortLabel: codec, category: 'standard' }
                    const isSelected = codec === currentCodec

                    return (
                        <DropdownMenuItem
                            key={codec}
                            onClick={() => onCodecChange(codec)}
                            className={cn(
                                "cursor-pointer flex items-center justify-between",
                                isSelected && "bg-primary/10"
                            )}
                        >
                            <span className="flex items-center gap-2">
                                <span className={cn(
                                    "w-1.5 h-1.5 rounded-full",
                                    info.category === 'hires' && "bg-purple-500",
                                    info.category === 'spatial' && "bg-blue-500",
                                    info.category === 'standard' && "bg-gray-400"
                                )} />
                                {info.label}
                            </span>
                            {isSelected && (
                                <span className="text-primary text-xs">✓</span>
                            )}
                        </DropdownMenuItem>
                    )
                })}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
