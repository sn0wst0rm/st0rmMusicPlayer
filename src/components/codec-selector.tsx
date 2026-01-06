"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ChevronDown, Waves, AlertTriangle } from "lucide-react"

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

// Check if browser supports a codec
function checkCodecSupport(codec: string): boolean {
    if (typeof window === 'undefined') return true // SSR

    const audio = document.createElement('audio')

    // MIME types for each codec
    const mimeTypes: Record<string, string[]> = {
        'aac-legacy': ['audio/mp4; codecs="mp4a.40.2"'],
        'aac-he-legacy': ['audio/mp4; codecs="mp4a.40.5"'],
        'aac': ['audio/mp4; codecs="mp4a.40.2"'],
        'aac-he': ['audio/mp4; codecs="mp4a.40.5"'],
        'alac': ['audio/mp4; codecs="alac"', 'audio/x-m4a'],
        'atmos': ['audio/mp4; codecs="ec-3"', 'audio/mp4; codecs="ac-3"'],
        'aac-binaural': ['audio/mp4; codecs="mp4a.40.2"'],
        'aac-downmix': ['audio/mp4; codecs="mp4a.40.2"'],
        'ac3': ['audio/mp4; codecs="ac-3"', 'audio/ac3'],
    }

    const codeMimes = mimeTypes[codec] || ['audio/mp4']

    // Check if any of the MIME types are supported
    for (const mime of codeMimes) {
        const canPlay = audio.canPlayType(mime)
        if (canPlay === 'probably' || canPlay === 'maybe') {
            return true
        }
    }

    return false
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
            <div
                className={cn(
                    "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium backdrop-blur-md",
                    info.category === 'hires' && "bg-black/40 text-purple-200 border border-purple-400/50",
                    info.category === 'spatial' && "bg-black/40 text-blue-200 border border-blue-400/50",
                    info.category === 'standard' && "bg-black/40 text-white border border-white/40",
                    className
                )}
                style={{ textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}>
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
                    "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors backdrop-blur-md",
                    "hover:brightness-110 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/50",
                    currentInfo.category === 'hires' && "bg-black/40 text-purple-200 border border-purple-400/50 hover:bg-black/50",
                    currentInfo.category === 'spatial' && "bg-black/40 text-blue-200 border border-blue-400/50 hover:bg-black/50",
                    currentInfo.category === 'standard' && "bg-black/40 text-white border border-white/40 hover:bg-black/50",
                    className
                )}
                style={{ textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}
                disabled={isLoading}
            >
                <Waves className="h-3 w-3" />
                {currentInfo.shortLabel}
                <ChevronDown className="h-3 w-3 opacity-60" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[200px]">
                {availableCodecs.map((codec) => {
                    const info = CODEC_INFO[codec] || { label: codec.toUpperCase(), shortLabel: codec, category: 'standard' }
                    const isSelected = codec === currentCodec
                    const isSupported = checkCodecSupport(codec)

                    return (
                        <DropdownMenuItem
                            key={codec}
                            onClick={() => onCodecChange(codec)}
                            className={cn(
                                "cursor-pointer flex items-center justify-between gap-2",
                                isSelected && "bg-primary/10",
                                !isSupported && "opacity-70"
                            )}
                            title={!isSupported ? "May not be supported in this browser" : undefined}
                        >
                            <span className="flex items-center gap-2">
                                <span className={cn(
                                    "w-1.5 h-1.5 rounded-full flex-shrink-0",
                                    info.category === 'hires' && "bg-purple-500",
                                    info.category === 'spatial' && "bg-blue-500",
                                    info.category === 'standard' && "bg-gray-400"
                                )} />
                                <span className="flex-1">{info.label}</span>
                                {!isSupported && (
                                    <AlertTriangle className="h-3 w-3 text-amber-500 flex-shrink-0" />
                                )}
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
