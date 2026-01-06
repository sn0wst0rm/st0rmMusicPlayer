"use client"

import * as React from "react"
import { usePlayerStore } from "@/lib/store"
import { cn } from "@/lib/utils"
import { GripVertical, AlertTriangle } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { isCodecSupportedInBrowser, getBrowserName } from "@/lib/browser-codec-support"

// Codec display names
const CODEC_LABELS: Record<string, { label: string; category: 'standard' | 'hires' | 'spatial' }> = {
    'alac': { label: 'Lossless (ALAC)', category: 'hires' },
    'atmos': { label: 'Dolby Atmos', category: 'spatial' },
    'aac-binaural': { label: 'Spatial Audio', category: 'spatial' },
    'aac': { label: 'AAC (48kHz)', category: 'standard' },
    'aac-he': { label: 'AAC-HE', category: 'standard' },
    'aac-legacy': { label: 'AAC 256kbps', category: 'standard' },
    'aac-he-legacy': { label: 'AAC-HE 64kbps', category: 'standard' },
    'ac3': { label: 'AC3 Surround', category: 'spatial' },
    'aac-downmix': { label: 'Downmix', category: 'standard' },
}


export function CodecPrioritySettings() {
    const { codecPriority, setCodecPriority } = usePlayerStore()
    const [draggedIndex, setDraggedIndex] = React.useState<number | null>(null)
    const [supportedCodecs, setSupportedCodecs] = React.useState<Record<string, boolean>>({})

    // Check codec support on mount
    React.useEffect(() => {
        const support: Record<string, boolean> = {}
        for (const codec of codecPriority) {
            support[codec] = isCodecSupportedInBrowser(codec)
        }
        setSupportedCodecs(support)
    }, [codecPriority])

    const handleDragStart = (index: number) => {
        setDraggedIndex(index)
    }

    const handleDragOver = (e: React.DragEvent, index: number) => {
        e.preventDefault()
        if (draggedIndex === null || draggedIndex === index) return

        // Reorder the list
        const newPriority = [...codecPriority]
        const draggedItem = newPriority[draggedIndex]
        newPriority.splice(draggedIndex, 1)
        newPriority.splice(index, 0, draggedItem)
        setCodecPriority(newPriority)
        setDraggedIndex(index)
    }

    const handleDragEnd = () => {
        setDraggedIndex(null)
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">Codec Priority</CardTitle>
                <CardDescription className="text-sm">
                    Drag to reorder. The player will use the first available codec from this list.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <div className="space-y-1">
                    {codecPriority.map((codec, index) => {
                        const info = CODEC_LABELS[codec] || { label: codec.toUpperCase(), category: 'standard' }
                        const isSupported = supportedCodecs[codec] !== false

                        return (
                            <div
                                key={codec}
                                draggable
                                onDragStart={() => handleDragStart(index)}
                                onDragOver={(e) => handleDragOver(e, index)}
                                onDragEnd={handleDragEnd}
                                className={cn(
                                    "flex items-center gap-3 p-2 rounded-lg border bg-card cursor-move transition-all",
                                    "hover:bg-accent/50",
                                    draggedIndex === index && "opacity-50 border-primary",
                                    !isSupported && "opacity-60"
                                )}
                            >
                                <GripVertical className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                                <span className="text-sm font-medium text-muted-foreground w-5">
                                    {index + 1}.
                                </span>
                                <span className={cn(
                                    "w-2 h-2 rounded-full flex-shrink-0",
                                    info.category === 'hires' && "bg-purple-500",
                                    info.category === 'spatial' && "bg-blue-500",
                                    info.category === 'standard' && "bg-gray-400"
                                )} />
                                <span className="flex-1 text-sm">{info.label}</span>
                                {!isSupported && (
                                    <span className="flex items-center gap-1 text-xs text-amber-500">
                                        <AlertTriangle className="h-3 w-3" />
                                        <span className="hidden sm:inline">Not supported</span>
                                    </span>
                                )}
                            </div>
                        )
                    })}
                </div>
                <p className="text-xs text-muted-foreground mt-3">
                    Unsupported codecs will be skipped automatically. Use Safari for best codec support.
                </p>
            </CardContent>
        </Card>
    )
}
