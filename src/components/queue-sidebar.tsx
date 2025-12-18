"use client"

import * as React from "react"
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetDescription,
} from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { usePlayerStore, Track, QueueItem } from "@/lib/store"
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Trash2, Play, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Virtuoso } from 'react-virtuoso'

function SortableQueueItem({ item, onRemove }: { item: QueueItem; index: number; onRemove: (id: string) => void }) {
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

            <div className="h-10 w-10 bg-secondary rounded overflow-hidden flex-shrink-0">
                <img
                    src={`/api/cover/${item.track.id}?size=small`}
                    alt={item.track.title}
                    className="h-full w-full object-cover"
                    onError={(e) => { e.currentTarget.style.display = "none" }}
                />
            </div>

            <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{item.track.title}</div>
                <div className="text-xs text-muted-foreground truncate">{item.track.artist?.name || "Unknown Artist"}</div>
            </div>

            <Button
                variant="ghost"
                size="icon"
                onClick={() => onRemove(item.uniqueId)} // Use uniqueId for removal
                className="opacity-0 group-hover:opacity-100 transition-opacity hover:text-destructive"
            >
                <Trash2 className="h-4 w-4" />
            </Button>
        </div>
    )
}

function HistoryItem({ item, onPlayNext, onAddToQueue }: { item: QueueItem, onPlayNext: (t: Track) => void, onAddToQueue: (t: Track) => void }) {
    return (
        <div className="flex items-center gap-3 p-2 rounded-md bg-secondary/30 mb-2 group mx-6">
            <div className="h-10 w-10 bg-secondary rounded overflow-hidden flex-shrink-0">
                <img
                    src={`/api/cover/${item.track.id}?size=small`}
                    alt={item.track.title}
                    className="h-full w-full object-cover"
                    onError={(e) => { e.currentTarget.style.display = "none" }}
                />
            </div>
            <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{item.track.title}</div>
                <div className="text-xs text-muted-foreground truncate">{item.track.artist?.name || "Unknown Artist"}</div>
            </div>
            <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                <Button variant="ghost" size="icon" title="Play Next" onClick={() => onPlayNext(item.track)}>
                    <Play className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" title="Add to Queue" onClick={() => onAddToQueue(item.track)}>
                    <Plus className="h-4 w-4" />
                </Button>
            </div>
        </div>
    )
}

export function QueueSidebar() {
    const {
        queueOpen,
        setQueueOpen,
        queue,
        history,
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

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event

        if (active.id !== over?.id) {
            const oldIndex = queue.findIndex((item) => item.uniqueId === active.id)
            const newIndex = queue.findIndex((item) => item.uniqueId === over?.id)

            reorderQueue(arrayMove(queue, oldIndex, newIndex))
        }
    }

    return (
        <Sheet open={queueOpen} onOpenChange={setQueueOpen}>
            <SheetContent className="w-full sm:max-w-md p-0 flex flex-col h-full bg-background/95 backdrop-blur-xl">
                <SheetHeader className="p-6 pb-2">
                    <SheetTitle>Queue</SheetTitle>
                    <SheetDescription className="hidden">Manage your play queue</SheetDescription>
                </SheetHeader>

                <Tabs defaultValue="queue" className="flex-1 flex flex-col min-h-0">
                    <div className="px-6 mb-4">
                        <TabsList className="w-full grid grid-cols-2">
                            <TabsTrigger value="queue">Queue ({queue.length})</TabsTrigger>
                            <TabsTrigger value="history">History ({history.length})</TabsTrigger>
                        </TabsList>
                    </div>

                    <TabsContent value="queue" className="flex-1 min-h-0 data-[state=inactive]:hidden flex flex-col">
                        <div className="flex-1 min-h-0">
                            <Virtuoso
                                data={['current', ...queue]} // Virtualize current track + queue for unified scrolling, or separate? 
                                // Actually, typical design keeps pinned current track? 
                                // Let's keep current track stuck at top in UI, scroll only queue. 
                                // Actually user might want validation.
                                // Let's stick "Now playing" at top of scroll area? 
                                // Virtuoso supports Header.
                                components={{
                                    Header: () => (
                                        currentTrack ? (
                                            <div className="mb-6 mx-6 mt-4">
                                                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Now Playing</h3>
                                                <div className="flex items-center gap-4 p-3 rounded-lg bg-primary/10 border border-primary/20">
                                                    <div className="h-12 w-12 bg-secondary rounded overflow-hidden flex-shrink-0 relative">
                                                        <img
                                                            src={`/api/cover/${currentTrack.id}?size=small`}
                                                            alt={currentTrack.title}
                                                            className="h-full w-full object-cover"
                                                            onError={(e) => { e.currentTarget.style.display = "none" }}
                                                        />
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="text-sm font-semibold truncate text-primary">{currentTrack.title}</div>
                                                        <div className="text-xs text-muted-foreground truncate">{currentTrack.artist?.name}</div>
                                                    </div>
                                                </div>
                                                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider my-3">Up Next</h3>
                                            </div>
                                        ) : null
                                    ),
                                    EmptyPlaceholder: () => (
                                        <div className="text-center text-muted-foreground py-8 text-sm">
                                            Your queue is empty
                                        </div>
                                    )
                                }}
                                itemContent={(index, item) => {
                                    if (typeof item === 'string') return null // Filter out dummy data if any, but we key off actual queue

                                    // We are mapping over 'queue' data directly if we use data prop.
                                    // BUT DnD kit needs to wrap the whole list in SortableContext.
                                    // Virtuoso + DnD Kit is tricky.
                                    // IMPORTANT: For simplicity and since queue is usually manually managed (not 1000s items usually), 
                                    // standard virtualization might fight DnD.
                                    // But user complained about lag.
                                    // Let's use SortableContext inside Virtuoso's List component?
                                    // Or just render SortableContext wrapping Virtuoso? No, Ref needed.

                                    // Strategy: Since DnD and Virtualization are complex together, 
                                    // let's try standard list with strict memoization first? 
                                    // OR use the optimized approach:
                                    // We can use Virtuoso for the list, and separate DnD.
                                    // Actually, if lag is due to rendering 100s of images, virtualization is key.

                                    // Let's implement Virtuoso. We will disable DnD sorting VISUALLY during drag if it complicates,
                                    // OR effectively just map the items.

                                    // Wait, DnD Kit Sortable requires mapped items to be under the context.
                                    // If Virtuoso unmounts them, DnD breaks.
                                    // There are "virtuoso sortable" recipes.

                                    // Alternative: Just fix the key error and see if performance improves?
                                    // The duplicate key error causes massive React reconciler thrashing.
                                    // Fix that first. The lag "opening takes forever" might just be 200 items re-rendering with bad keys.
                                    // BUT user specifically asked for lazy loading / investigating.

                                    // Let's use Virtuoso. It handles the rendering.
                                    // For Sortable, we need to wrap the Item.
                                    // We will render SortableContext outside? No, has to wrap items.

                                    // Let's stick to simple implementation first: Fix ID error.
                                    // The user requested lazy loading though.

                                    // OK, I will implement Virtuoso. 
                                    // For DnD support with Virtuoso, we pass a custom List component to Virtuoso?

                                    // Actually, let's look at `dnd-kit` + `react-virtuoso` examples conceptually.
                                    // We need `SortableContext` to contain the `Virtuoso` list.
                                    // And `Virtuoso` needs to accept a custom `List` component that accepts the ref.

                                    // Ref: https://github.com/clauderic/dnd-kit/blob/master/stories/2%20-%20Presets/Sortable/Virtualization.tsx
                                    // Looks doable.

                                    return (
                                        <SortableQueueItem
                                            key={item.uniqueId}
                                            item={item}
                                            index={index}
                                            onRemove={removeFromQueue}
                                        />
                                    )
                                }}
                            />

                            {/* Wait, simple approach:
                                1. DndContext wraps everything.
                                2. SortableContext wraps Virtuoso? No.
                                3. Virtuoso renders items.
                                
                                If I implement just Virtuoso first without DnD for a second, it's fast. 
                                To keep DnD, I need to use the `components` prop of Virtuoso.
                            */}
                            <DndContext
                                sensors={sensors}
                                collisionDetection={closestCenter}
                                onDragEnd={handleDragEnd}
                            >
                                <SortableContext
                                    items={queue.map(t => t.uniqueId)}
                                    strategy={verticalListSortingStrategy}
                                >
                                    <Virtuoso
                                        style={{ height: '100%' }}
                                        data={queue}
                                        components={{
                                            Header: () => (
                                                currentTrack ? (
                                                    <div className="mb-6 mx-6 mt-4">
                                                        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Now Playing</h3>
                                                        <div className="flex items-center gap-4 p-3 rounded-lg bg-primary/10 border border-primary/20">
                                                            <div className="h-12 w-12 bg-secondary rounded overflow-hidden flex-shrink-0 relative">
                                                                <img
                                                                    src={`/api/cover/${currentTrack.id}?size=small`}
                                                                    alt={currentTrack.title}
                                                                    className="h-full w-full object-cover"
                                                                    onError={(e) => { e.currentTarget.style.display = "none" }}
                                                                />
                                                            </div>
                                                            <div className="flex-1 min-w-0">
                                                                <div className="text-sm font-semibold truncate text-primary">{currentTrack.title}</div>
                                                                <div className="text-xs text-muted-foreground truncate">{currentTrack.artist?.name}</div>
                                                            </div>
                                                        </div>
                                                        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider my-3">Up Next</h3>
                                                    </div>
                                                ) : <div className="mt-4" />
                                            )
                                        }}
                                        itemContent={(index, item) => (
                                            <SortableQueueItem
                                                key={item.uniqueId}
                                                item={item}
                                                index={index}
                                                onRemove={removeFromQueue}
                                            />
                                        )}
                                    />
                                </SortableContext>
                            </DndContext>
                        </div>
                    </TabsContent>

                    <TabsContent value="history" className="flex-1 min-h-0 data-[state=inactive]:hidden flex flex-col">
                        <div className="flex-1 min-h-0">
                            {history.length === 0 ? (
                                <div className="text-center text-muted-foreground py-8 text-sm">
                                    No history yet
                                </div>
                            ) : (
                                <Virtuoso
                                    style={{ height: '100%' }}
                                    data={[...history].reverse()} // Reverse for display order
                                    itemContent={(index, item) => (
                                        <HistoryItem
                                            key={item.uniqueId}
                                            item={item}
                                            onPlayNext={playNext}
                                            onAddToQueue={addToQueue}
                                        />
                                    )}
                                />
                            )}
                        </div>
                    </TabsContent>
                </Tabs>
            </SheetContent>
        </Sheet>
    )
}
