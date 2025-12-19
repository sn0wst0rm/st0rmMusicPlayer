import { Virtuoso, VirtuosoHandle, ListRange } from 'react-virtuoso'
import { RefObject, useState, useCallback, useEffect } from "react"
import { Play, Clock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Track } from "@/lib/store"

interface SongsViewProps {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    songs: any[]
    currentTrack: Track | null
    isPlaying: boolean
    playTrack: (track: Track, queue: Track[]) => void
    onSelectAlbum?: (albumId: string) => void
    onScroll: (e: React.UIEvent<HTMLElement>) => void
    tableVirtuosoRef: RefObject<VirtuosoHandle | null>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tableComponents: any
    TableHeaderContent: React.FC
    formatDuration: (seconds: number) => string
    onRangeChanged?: (range: ListRange) => void
}

// Column configuration - used for type only
type ColumnKey = 'index' | 'title' | 'artist' | 'album' | 'duration'

const DEFAULT_WIDTHS: Record<ColumnKey, number> = {
    index: 48,
    title: 400,
    artist: 250,
    album: 300,
    duration: 80
}

const MIN_WIDTHS: Record<ColumnKey, number> = {
    index: 40,
    title: 100,
    artist: 80,
    album: 80,
    duration: 60
}

export function SongsView({
    songs,
    currentTrack,
    isPlaying,
    playTrack,
    onSelectAlbum,
    onScroll,
    tableVirtuosoRef,
    TableHeaderContent,
    formatDuration,
    onRangeChanged
}: SongsViewProps) {
    const items = ["HEADER", ...songs]

    // Column widths state
    const [columnWidths, setColumnWidths] = useState<Record<ColumnKey, number>>(DEFAULT_WIDTHS)

    // Resize state
    const [resizing, setResizing] = useState<{ column: ColumnKey; startX: number; startWidth: number } | null>(null)

    // Track if initial sizing has been done
    const [initialSizingDone, setInitialSizingDone] = useState(false)

    // Container width state (for potential future use)
    const [, setContainerWidth] = useState(0)

    // Resize observer for container - also sets initial column widths
    useEffect(() => {
        // Find the scroller element
        const scroller = document.querySelector('[data-virtuoso-scroller="true"]')
        if (!scroller) return

        const observer = new ResizeObserver(entries => {
            const width = entries[0]?.contentRect.width
            if (!width) return

            setContainerWidth(width)

            // Calculate initial column widths only once
            if (!initialSizingDone) {
                const availableWidth = width - 64 // Subtract px-8 padding (32px * 2)
                const fixedColumnsWidth = DEFAULT_WIDTHS.index + DEFAULT_WIDTHS.duration // These stay fixed
                const flexibleSpace = availableWidth - fixedColumnsWidth

                // Distribute flexible space proportionally: Title gets 40%, Artist 30%, Album 30%
                const titleWidth = Math.max(MIN_WIDTHS.title, Math.floor(flexibleSpace * 0.4))
                const artistWidth = Math.max(MIN_WIDTHS.artist, Math.floor(flexibleSpace * 0.3))
                const albumWidth = Math.max(MIN_WIDTHS.album, Math.floor(flexibleSpace * 0.3))

                setColumnWidths({
                    index: DEFAULT_WIDTHS.index,
                    title: titleWidth,
                    artist: artistWidth,
                    album: albumWidth,
                    duration: DEFAULT_WIDTHS.duration
                })
                setInitialSizingDone(true)
            }
        })

        observer.observe(scroller)
        return () => observer.disconnect()
    }, [initialSizingDone])

    // Generate grid template from widths
    const getGridTemplate = useCallback((isMobile: boolean) => {
        if (isMobile) {
            return `${columnWidths.index}px 1fr ${columnWidths.duration}px`
        }
        // Simple fixed-width columns - no dynamic fill calculation
        return `${columnWidths.index}px ${columnWidths.title}px ${columnWidths.artist}px ${columnWidths.album}px ${columnWidths.duration}px`
    }, [columnWidths])

    // Handle resize start
    const handleResizeStart = useCallback((e: React.MouseEvent, column: ColumnKey) => {
        e.preventDefault()
        e.stopPropagation()
        setResizing({
            column,
            startX: e.clientX,
            startWidth: columnWidths[column]
        })
    }, [columnWidths])

    // Handle resize move and end
    useEffect(() => {
        if (!resizing) return

        const handleMouseMove = (e: MouseEvent) => {
            const delta = e.clientX - resizing.startX
            const newWidth = Math.max(MIN_WIDTHS[resizing.column], resizing.startWidth + delta)
            setColumnWidths(prev => ({
                ...prev,
                [resizing.column]: newWidth
            }))
        }

        const handleMouseUp = () => {
            setResizing(null)
        }

        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('mouseup', handleMouseUp)

        return () => {
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)
        }
    }, [resizing])

    // Column header cell with optional grabber
    const HeaderCell = ({ column, children, isLast = false, className = "" }: {
        column: ColumnKey
        children: React.ReactNode
        isLast?: boolean
        className?: string
    }) => (
        <div className={cn(
            "relative flex items-center h-full border-r border-border/50",
            column === 'index' ? 'px-2' : 'px-4',
            isLast && "border-r-0",
            className
        )}>
            <div className="flex-1 truncate">{children}</div>
            {!isLast && (
                <div
                    className="absolute -right-2 top-0 h-full w-4 cursor-col-resize hover:bg-transparent z-10"
                    onMouseDown={(e) => handleResizeStart(e, column)}
                />
            )}
        </div>
    )

    return (
        <div className="flex flex-col h-full w-full">
            <div className="flex-1 min-h-0 relative overflow-x-hidden pt-14">
                <div className="flex-1 min-w-0 h-full">
                    <Virtuoso
                        ref={tableVirtuosoRef}
                        className="no-scrollbar"
                        data={items}
                        context={{ playTrack, allSongs: songs }}
                        topItemCount={1}
                        style={{ height: '100%', overscrollBehavior: 'none' }}
                        components={{
                            Header: () => <TableHeaderContent />
                        }}
                        itemContent={(index, item) => {
                            if (item === "HEADER") {
                                return (
                                    <div className={cn(
                                        "sticky top-0 z-20 w-full bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b shadow-sm transition-shadow duration-200",
                                        resizing && "select-none"
                                    )}>
                                        <div
                                            className="flex px-8 py-3 text-sm font-medium text-muted-foreground w-full"
                                            style={{ display: 'grid', gridTemplateColumns: getGridTemplate(false) }}
                                        >
                                            <HeaderCell column="index">#</HeaderCell>
                                            <HeaderCell column="title">Title</HeaderCell>
                                            <HeaderCell column="artist" className="hidden md:flex">Artist</HeaderCell>
                                            <HeaderCell column="album" className="hidden md:flex">Album</HeaderCell>
                                            <HeaderCell column="duration" isLast className="justify-end pr-6">
                                                <Clock className="h-4 w-4" />
                                            </HeaderCell>
                                        </div>
                                    </div>
                                )
                            }

                            const track = item
                            const realIndex = index - 1

                            return (
                                <div className="px-8 w-full group">
                                    <div
                                        className={cn(
                                            "py-2 text-sm cursor-pointer items-center rounded-sm transition-colors hover:bg-muted/50",
                                            isPlaying && currentTrack?.id === track.id && "bg-muted/50"
                                        )}
                                        style={{ display: 'grid', gridTemplateColumns: getGridTemplate(false) }}
                                        onClick={() => playTrack(track, songs)}
                                    >
                                        {/* Index column */}
                                        <div className="px-2 font-medium tabular-nums text-muted-foreground flex items-center w-full relative border-r border-border/50 h-full">
                                            <div className="h-8 flex items-center relative">
                                                <span className={cn(
                                                    "group-hover:opacity-0 transition-opacity",
                                                    isPlaying && currentTrack?.id === track.id && "opacity-0"
                                                )}>
                                                    {realIndex + 1}
                                                </span>
                                                <div className="absolute inset-0 flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <Button
                                                        size="icon"
                                                        variant="ghost"
                                                        className="h-8 w-8 hover:bg-transparent hover:text-primary p-0 flex items-center justify-start"
                                                        onClick={(e) => {
                                                            e.stopPropagation()
                                                            playTrack(track, songs)
                                                        }}
                                                    >
                                                        <Play className={cn("h-4 w-4 fill-current", isPlaying && currentTrack?.id === track.id && "fill-primary text-primary")} />
                                                    </Button>
                                                </div>
                                                {isPlaying && currentTrack?.id === track.id && (
                                                    <div className="absolute inset-0 flex items-center">
                                                        <Play className="h-4 w-4 fill-primary text-primary" />
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {/* Title column */}
                                        <div className="flex flex-col min-w-0 px-4 border-r border-border/50 h-full justify-center">
                                            <span className={cn("truncate font-medium", isPlaying && currentTrack?.id === track.id && "text-primary")}>{track.title}</span>
                                            <span className="text-xs text-muted-foreground md:hidden truncate">{track.artist?.name}</span>
                                        </div>

                                        {/* Artist column */}
                                        <div className="hidden md:flex text-muted-foreground min-w-0 px-4 border-r border-border/50 h-full items-center">
                                            <span className="truncate">{track.artist?.name}</span>
                                        </div>

                                        {/* Album column */}
                                        <div className="hidden md:flex text-muted-foreground min-w-0 px-4 border-r border-border/50 h-full items-center">
                                            <span
                                                className="truncate hover:underline hover:text-foreground cursor-pointer transition-colors"
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    if (onSelectAlbum && track.albumId) {
                                                        onSelectAlbum(track.albumId)
                                                    }
                                                }}
                                            >
                                                {track.album?.title}
                                            </span>
                                        </div>

                                        {/* Duration column */}
                                        <div className="text-right text-muted-foreground font-variant-numeric tabular-nums pr-6 select-none h-full flex items-center justify-end">
                                            {formatDuration(track.duration)}
                                        </div>
                                    </div>
                                </div>
                            )
                        }}
                        onScroll={onScroll}
                        rangeChanged={onRangeChanged}
                    />
                </div>
            </div>
        </div>
    )
}
