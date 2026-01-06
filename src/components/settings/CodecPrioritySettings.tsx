"use client"

import * as React from "react"
import { usePlayerStore } from "@/lib/store"
import { cn } from "@/lib/utils"
import { GripVertical, AlertTriangle } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { isCodecSupportedInBrowser } from "@/lib/browser-codec-support"
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    TouchSensor,
    useSensor,
    useSensors,
    DragEndEvent
} from '@dnd-kit/core'
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
    useSortable
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

// Codec display names
const CODEC_LABELS: Record<string, { label: string; category: 'standard' | 'hires' | 'spatial' }> = {
    'alac': { label: 'Lossless (ALAC)', category: 'hires' },
    'atmos': { label: 'Dolby Atmos', category: 'spatial' },
    'aac-binaural': { label: 'Spatial Audio', category: 'spatial' },
    'aac-he-binaural': { label: 'HE Spatial Audio', category: 'spatial' },
    'aac': { label: 'AAC (48kHz)', category: 'standard' },
    'aac-he': { label: 'AAC-HE', category: 'standard' },
    'aac-legacy': { label: 'AAC 256kbps', category: 'standard' },
    'aac-he-legacy': { label: 'AAC-HE 64kbps', category: 'standard' },
    'ac3': { label: 'AC3 Surround', category: 'spatial' },
    'aac-downmix': { label: 'Downmix', category: 'standard' },
    'aac-he-downmix': { label: 'HE Downmix', category: 'standard' },
}

// Sortable codec item component
function SortableCodecItem({
    codec,
    index,
    isSupported
}: {
    codec: string
    index: number
    isSupported: boolean
}) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id: codec })

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 50 : 'auto',
        position: isDragging ? 'relative' as const : 'static' as const,
    }

    const info = CODEC_LABELS[codec] || { label: codec.toUpperCase(), category: 'standard' }

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={cn(
                "flex items-center gap-3 p-2 rounded-lg border bg-card touch-none",
                "hover:bg-accent/50",
                isDragging && "opacity-50 border-primary ring-2 ring-primary",
                !isSupported && "opacity-60"
            )}
        >
            <div
                {...attributes}
                {...listeners}
                className="cursor-move text-muted-foreground hover:text-foreground touch-none"
            >
                <GripVertical className="h-4 w-4 flex-shrink-0" />
            </div>
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
}

export function CodecPrioritySettings() {
    const { codecPriority, setCodecPriority } = usePlayerStore()
    const [supportedCodecs, setSupportedCodecs] = React.useState<Record<string, boolean>>({})

    // Check codec support on mount
    React.useEffect(() => {
        const support: Record<string, boolean> = {}
        for (const codec of codecPriority) {
            support[codec] = isCodecSupportedInBrowser(codec)
        }
        setSupportedCodecs(support)
    }, [codecPriority])

    // Configure sensors for both mouse and touch
    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 8, // 8px movement before drag starts
            },
        }),
        useSensor(TouchSensor, {
            activationConstraint: {
                delay: 150, // 150ms delay for touch
                tolerance: 5,
            },
        }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    )

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event

        if (active.id !== over?.id) {
            const oldIndex = codecPriority.indexOf(String(active.id))
            const newIndex = codecPriority.indexOf(String(over?.id))

            if (oldIndex !== -1 && newIndex !== -1) {
                setCodecPriority(arrayMove(codecPriority, oldIndex, newIndex))
            }
        }
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
                <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleDragEnd}
                >
                    <SortableContext
                        items={codecPriority}
                        strategy={verticalListSortingStrategy}
                    >
                        <div className="space-y-1">
                            {codecPriority.map((codec, index) => (
                                <SortableCodecItem
                                    key={codec}
                                    codec={codec}
                                    index={index}
                                    isSupported={supportedCodecs[codec] === true}
                                />
                            ))}
                        </div>
                    </SortableContext>
                </DndContext>
                <p className="text-xs text-muted-foreground mt-3">
                    Unsupported codecs will be skipped automatically. Use Safari for best codec support.
                </p>
            </CardContent>
        </Card>
    )
}
