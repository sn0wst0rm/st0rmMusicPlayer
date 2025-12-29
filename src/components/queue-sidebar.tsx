"use client"

import * as React from "react"
import { memo, useCallback, useState } from "react"
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetDescription,
} from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { usePlayerStore, Track, QueueItem, PlaybackHistoryEntry } from "@/lib/store"
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Trash2, Play, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Virtuoso } from 'react-virtuoso'
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "sonner"

// Cover art with skeleton loading
const CoverArtWithSkeleton = memo(function CoverArtWithSkeleton({
    trackId,
    alt,
    size = "small"
}: {
    trackId: string
    alt: string
    size?: "small" | "medium"
}) {
    const [isLoaded, setIsLoaded] = useState(false)

    const sizeClass = size === "small" ? "h-10 w-10" : "h-12 w-12"

    return (
        <div className={cn(sizeClass, "bg-secondary rounded overflow-hidden flex-shrink-0 relative")}>
            {!isLoaded && (
                <Skeleton className="absolute inset-0 w-full h-full bg-primary/10" />
            )}
            <img
                src={`/api/cover/${trackId}?size=small`}
                alt={alt}
                className={cn("h-full w-full object-cover transition-opacity duration-200", !isLoaded && "opacity-0")}
                onLoad={() => setIsLoaded(true)}
                onError={(e) => { e.currentTarget.style.display = 'none' }}
            />
        </div>
    )
})

// Memoized SortableQueueItem to prevent unnecessary re-renders
const SortableQueueItem = memo(function SortableQueueItem({
    item,
    onRemove
}: {
    item: QueueItem
    onRemove: (id: string) => void
}) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id: item.uniqueId })

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 50 : "auto",
        position: isDragging ? 'relative' as const : 'static' as const,
    }

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={cn(
                "flex items-center gap-3 p-2 rounded-md bg-secondary/30 mb-2 group touch-none mx-6",
                isDragging && "opacity-50 ring-2 ring-primary"
            )}
        >
            <div
                {...attributes}
                {...listeners}
                className="cursor-move text-muted-foreground hover:text-foreground touch-none"
            >
                <GripVertical className="h-5 w-5" />
            </div>

            <CoverArtWithSkeleton trackId={item.track.id} alt={item.track.title} />

            <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{item.track.title}</div>
                <div className="text-xs text-muted-foreground truncate">{item.track.artist?.name || "Unknown Artist"}</div>
            </div>

            <Button
                variant="ghost"
                size="icon"
                onClick={() => onRemove(item.uniqueId)}
                className="opacity-0 group-hover:opacity-100 transition-opacity hover:text-destructive"
            >
                <Trash2 className="h-4 w-4" />
            </Button>
        </div>
    )
})

// Format relative time for history entries
function formatRelativeTime(timestamp: number): string {
    const now = Date.now()
    const diff = now - timestamp

    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)

    if (minutes < 1) return "Just now"
    if (minutes < 60) return `${minutes}m ago`
    if (hours < 24) return `${hours}h ago`
    if (days < 7) return `${days}d ago`

    // Format as date for older entries
    return new Date(timestamp).toLocaleDateString()
}

// Memoized HistoryItem component for persistent playback history
const PlaybackHistoryItem = memo(function PlaybackHistoryItem({
    entry,
    onPlayNext,
    onAddToQueue
}: {
    entry: PlaybackHistoryEntry
    onPlayNext: (t: Track) => void
    onAddToQueue: (t: Track) => void
}) {
    return (
        <div className="flex items-center gap-3 p-2 rounded-md bg-secondary/30 mb-2 group mx-6">
            <CoverArtWithSkeleton trackId={entry.track.id} alt={entry.track.title} />
            <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{entry.track.title}</div>
                <div className="text-xs text-muted-foreground truncate">
                    {entry.track.artist?.name || "Unknown Artist"}
                    <span className="mx-1">•</span>
                    <span className="opacity-70">{formatRelativeTime(entry.playedAt)}</span>
                </div>
            </div>
            <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                <Button variant="ghost" size="icon" title="Play Next" onClick={() => {
                    onPlayNext(entry.track)
                    toast.success("Playing Next", {
                        description: entry.track.title
                    })
                }}>
                    <Play className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" title="Add to Queue" onClick={() => {
                    onAddToQueue(entry.track)
                    toast.success("Added to Queue", {
                        description: entry.track.title
                    })
                }}>
                    <Plus className="h-4 w-4" />
                </Button>
            </div>
        </div>
    )
})

// Now Playing header component - memoized
const NowPlayingHeader = memo(function NowPlayingHeader({ currentTrack }: { currentTrack: Track | null }) {
    if (!currentTrack) {
        return <div className="mt-4" />
    }

    return (
        <div className="mb-6 mx-6 mt-4">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Now Playing</h3>
            <div className="flex items-center gap-4 p-3 rounded-lg bg-primary/10 border border-primary/20">
                <CoverArtWithSkeleton trackId={currentTrack.id} alt={currentTrack.title} size="medium" />
                <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate text-primary">{currentTrack.title}</div>
                    <div className="text-xs text-muted-foreground truncate">{currentTrack.artist?.name}</div>
                </div>
            </div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider my-3">Up Next</h3>
        </div>
    )
})

// Empty queue placeholder
const EmptyQueuePlaceholder = memo(function EmptyQueuePlaceholder() {
    return (
        <div className="text-center text-muted-foreground py-8 text-sm">
            Your queue is empty
        </div>
    )
})

export function QueueSidebar() {
    const {
        queueOpen,
        setQueueOpen,
        queue,
        playbackHistory,
        reorderQueue,
        removeFromQueue,
        playNext,
        addToQueue,
        currentTrack
    } = usePlayerStore()

    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    )

    const handleDragEnd = useCallback((event: DragEndEvent) => {
        const { active, over } = event

        if (active.id !== over?.id) {
            const oldIndex = queue.findIndex((item) => item.uniqueId === active.id)
            const newIndex = queue.findIndex((item) => item.uniqueId === over?.id)

            if (oldIndex !== -1 && newIndex !== -1) {
                reorderQueue(arrayMove(queue, oldIndex, newIndex))
            }
        }
    }, [queue, reorderQueue])

    // Memoized item IDs for SortableContext
    const queueItemIds = React.useMemo(() => queue.map(t => t.uniqueId), [queue])

    return (
        <Sheet open={queueOpen} onOpenChange={setQueueOpen}>
            <SheetContent className="w-full sm:max-w-md p-0 flex flex-col h-full bg-background/95 backdrop-blur-xl">
                <SheetHeader className="p-6 pb-2 flex-shrink-0">
                    <SheetTitle>Queue</SheetTitle>
                    <SheetDescription className="hidden">Manage your play queue</SheetDescription>
                </SheetHeader>

                <Tabs defaultValue="queue" className="flex-1 flex flex-col min-h-0 overflow-hidden">
                    <div className="px-6 mb-4 flex-shrink-0">
                        <TabsList className="w-full grid grid-cols-2">
                            <TabsTrigger value="queue">Queue ({queue.length})</TabsTrigger>
                            <TabsTrigger value="history">History ({playbackHistory.length})</TabsTrigger>
                        </TabsList>
                    </div>

                    <TabsContent value="queue" className="flex-1 min-h-0 data-[state=inactive]:hidden flex flex-col overflow-hidden">
                        {queueOpen && (
                            <div className="flex-1 min-h-0">
                                {queue.length === 0 && !currentTrack ? (
                                    <EmptyQueuePlaceholder />
                                ) : (
                                    <DndContext
                                        sensors={sensors}
                                        collisionDetection={closestCenter}
                                        onDragEnd={handleDragEnd}
                                    >
                                        <SortableContext
                                            items={queueItemIds}
                                            strategy={verticalListSortingStrategy}
                                        >
                                            <Virtuoso
                                                style={{ height: '100%' }}
                                                data={queue}
                                                overscan={200}
                                                components={{
                                                    Header: () => <NowPlayingHeader currentTrack={currentTrack} />,
                                                    Footer: () => <div className="h-6" />,
                                                    EmptyPlaceholder: () => (
                                                        <div className="text-center text-muted-foreground py-8 text-sm mx-6">
                                                            No upcoming tracks
                                                        </div>
                                                    )
                                                }}
                                                itemContent={(_, item) => (
                                                    <SortableQueueItem
                                                        key={item.uniqueId}
                                                        item={item}
                                                        onRemove={removeFromQueue}
                                                    />
                                                )}
                                            />
                                        </SortableContext>
                                    </DndContext>
                                )}
                            </div>
                        )}
                    </TabsContent>

                    <TabsContent value="history" className="flex-1 min-h-0 data-[state=inactive]:hidden flex flex-col overflow-hidden">
                        {queueOpen && (
                            <div className="flex-1 min-h-0">
                                {playbackHistory.length === 0 ? (
                                    <div className="text-center text-muted-foreground py-8 text-sm">
                                        No history yet
                                    </div>
                                ) : (
                                    <Virtuoso
                                        style={{ height: '100%' }}
                                        data={playbackHistory}
                                        overscan={200}
                                        components={{
                                            Header: () => <div className="h-4" />,
                                            Footer: () => <div className="h-6" />
                                        }}
                                        itemContent={(_, entry) => (
                                            <PlaybackHistoryItem
                                                key={entry.id}
                                                entry={entry}
                                                onPlayNext={playNext}
                                                onAddToQueue={addToQueue}
                                            />
                                        )}
                                    />
                                )}
                            </div>
                        )}
                    </TabsContent>
                </Tabs>
            </SheetContent>
        </Sheet>
    )
}
