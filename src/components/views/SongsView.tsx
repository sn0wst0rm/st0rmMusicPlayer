import { Virtuoso, VirtuosoHandle, ListRange } from 'react-virtuoso'
import { RefObject, useState, useCallback, useEffect, useRef, useLayoutEffect } from "react"
import { Play, Clock, Pause, ListPlus, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { AudioWaveform } from "@/components/ui/audio-waveform"
import { cn } from "@/lib/utils"
import { Track, usePlayerStore } from "@/lib/store"

interface SongsViewProps {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    songs: any[]
    currentTrack: Track | null
    isPlaying: boolean
    playTrack: (track: Track, queue: Track[]) => void
    onSelectAlbum?: (albumId: string) => void
    onArtistClick?: (artistName: string) => void
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
    duration: 110
}

const MIN_WIDTHS: Record<ColumnKey, number> = {
    index: 40,
    title: 100,
    artist: 80,
    album: 80,
    duration: 60
}

// Max widths to prevent overflow into letter selector area
const MAX_WIDTHS: Record<ColumnKey, number> = {
    index: 80,
    title: 800,
    artist: 500,
    album: 500,
    duration: 200
}

// Extracted component for the index/play/waveform cell
function IndexCell({
    track,
    realIndex,
    isPlaying,
    currentTrack,
    playTrack,
    songs
}: {
    track: Track
    realIndex: number
    isPlaying: boolean
    currentTrack: Track | null
    playTrack: (track: Track, queue: Track[]) => void
    songs: Track[]
}) {
    const { setIsPlaying } = usePlayerStore()
    const isCurrentTrack = currentTrack?.id === track.id
    const isCurrentlyPlaying = isPlaying && isCurrentTrack

    if (isCurrentlyPlaying) {
        // Currently playing: show waveform, pause on hover
        return (
            <div className="h-8 flex items-center relative">
                <AudioWaveform className="group-hover:hidden" />
                <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 hover:bg-transparent text-primary p-0 hidden group-hover:flex items-center justify-start"
                    onClick={(e) => {
                        e.stopPropagation()
                        setIsPlaying(false)
                    }}
                >
                    <Pause className="h-4 w-4 fill-current" />
                </Button>
            </div>
        )
    }

    if (isCurrentTrack && !isPlaying) {
        // Current track but paused: show pause icon, play on hover
        return (
            <div className="h-8 flex items-center relative">
                <Pause className="h-4 w-4 fill-primary text-primary group-hover:hidden" />
                <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 hover:bg-transparent text-primary p-0 hidden group-hover:flex items-center justify-start"
                    onClick={(e) => {
                        e.stopPropagation()
                        setIsPlaying(true)
                    }}
                >
                    <Play className="h-4 w-4 fill-current" />
                </Button>
            </div>
        )
    }

    // Not current track: show number, filled play on hover
    return (
        <div className="h-8 flex items-center relative">
            <span className="group-hover:opacity-0 transition-opacity">
                {realIndex + 1}
            </span>
            <div className="absolute inset-0 flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 hover:bg-transparent text-primary p-0 flex items-center justify-start"
                    onClick={(e) => {
                        e.stopPropagation()
                        playTrack(track, songs)
                    }}
                >
                    <Play className="h-4 w-4 fill-primary" />
                </Button>
            </div>
        </div>
    )
}

export function SongsView({
    songs,
    currentTrack,
    isPlaying,
    playTrack,
    onSelectAlbum,
    onArtistClick,
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

    // Track if initial sizing has been done - use ref to avoid stale closure in ResizeObserver
    const [initialSizingDone, setInitialSizingDone] = useState(false)
    const initialSizingDoneRef = useRef(false)

    // Container width state (for potential future use)
    const [, setContainerWidth] = useState(0)

    // Calculate column widths from container width
    const calculateWidths = useCallback((width: number) => {
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
        initialSizingDoneRef.current = true
        setInitialSizingDone(true)
    }, [])

    // Initial measurement using useLayoutEffect for immediate sizing
    // This runs synchronously after DOM mutations but before browser paint
    useLayoutEffect(() => {
        if (initialSizingDoneRef.current) return

        // Try to measure immediately
        const measureAndSize = () => {
            const scroller = document.querySelector('[data-virtuoso-scroller="true"]')
            if (scroller) {
                const rect = scroller.getBoundingClientRect()
                if (rect.width > 0) {
                    setContainerWidth(rect.width)
                    calculateWidths(rect.width)
                    return true
                }
            }
            return false
        }

        // Measure on mount
        if (measureAndSize()) return

        // Retry with increasing delays for Safari/iOS which may need more time
        // This handles cases where Virtuoso hasn't rendered yet
        let retryCount = 0
        const maxRetries = 10
        const baseDelay = 50

        const retryMeasure = () => {
            if (initialSizingDoneRef.current) return
            if (measureAndSize()) return

            retryCount++
            if (retryCount < maxRetries) {
                setTimeout(retryMeasure, baseDelay * retryCount)
            }
        }

        const timeoutId = setTimeout(retryMeasure, baseDelay)
        return () => clearTimeout(timeoutId)
    }, [calculateWidths])

    // Resize observer for container - handles window resizes after initial mount
    useEffect(() => {
        let observer: ResizeObserver | null = null
        let retryTimeoutId: ReturnType<typeof setTimeout> | null = null

        const setupObserver = () => {
            const scroller = document.querySelector('[data-virtuoso-scroller="true"]')
            if (!scroller) {
                // Retry after a short delay if element not yet available
                retryTimeoutId = setTimeout(setupObserver, 100)
                return
            }

            observer = new ResizeObserver(entries => {
                const width = entries[0]?.contentRect.width
                if (!width) return

                setContainerWidth(width)

                // If initial sizing wasn't done yet (Safari fallback), do it now
                if (!initialSizingDoneRef.current) {
                    calculateWidths(width)
                }
            })

            observer.observe(scroller)
        }

        setupObserver()

        return () => {
            if (retryTimeoutId) clearTimeout(retryTimeoutId)
            observer?.disconnect()
        }
    }, [calculateWidths])

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
            const newWidth = Math.min(
                MAX_WIDTHS[resizing.column],
                Math.max(MIN_WIDTHS[resizing.column], resizing.startWidth + delta)
            )
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
    }) => {
        const isCentered = className.includes('justify-center')
        return (
            <div className={cn(
                "relative flex items-center h-full border-r border-border/50",
                column === 'index' ? 'px-2' : 'px-4',
                isLast && "border-r-0",
                className
            )}>
                <div className={cn(isCentered ? "w-full flex justify-center" : "flex-1 truncate")}>{children}</div>
                {!isLast && (
                    <div
                        className="absolute -right-2 top-0 h-full w-4 cursor-col-resize hover:bg-transparent z-10"
                        onMouseDown={(e) => handleResizeStart(e, column)}
                    />
                )}
            </div>
        )
    }

    return (
        <div className="flex flex-col h-full w-full overflow-hidden">
            <div className="flex-1 min-h-0 relative overflow-hidden pt-14">
                <div className="flex-1 min-w-0 h-full overflow-hidden">
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
                                            className="flex px-8 pr-6 py-3 text-sm font-medium text-muted-foreground w-full"
                                            style={{ display: 'grid', gridTemplateColumns: getGridTemplate(false) }}
                                        >
                                            <HeaderCell column="index">#</HeaderCell>
                                            <HeaderCell column="title">Title</HeaderCell>
                                            <HeaderCell column="artist" className="hidden md:flex">Artist</HeaderCell>
                                            <HeaderCell column="album" className="hidden md:flex">Album</HeaderCell>
                                            <HeaderCell column="duration" isLast className="justify-center">
                                                <Clock className="h-4 w-4" />
                                            </HeaderCell>
                                        </div>
                                    </div>
                                )
                            }

                            const track = item
                            const realIndex = index - 1

                            return (
                                <div className="px-8 pr-6 w-full group">
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
                                            <IndexCell
                                                track={track}
                                                realIndex={realIndex}
                                                isPlaying={isPlaying}
                                                currentTrack={currentTrack}
                                                playTrack={playTrack}
                                                songs={songs}
                                            />
                                        </div>

                                        {/* Title column */}
                                        <div className="flex flex-col min-w-0 px-4 border-r border-border/50 h-full justify-center">
                                            <span className={cn("truncate font-medium", isPlaying && currentTrack?.id === track.id && "text-primary")}>{track.title}</span>
                                            <span className="text-xs text-muted-foreground md:hidden truncate">{track.artist?.name}</span>
                                        </div>

                                        {/* Artist column */}
                                        <div className="hidden md:flex text-muted-foreground min-w-0 px-4 border-r border-border/50 h-full items-center">
                                            <span
                                                className="truncate hover:underline hover:text-foreground cursor-pointer transition-colors"
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    if (onArtistClick && track.artist?.name) {
                                                        onArtistClick(track.artist.name)
                                                    }
                                                }}
                                            >
                                                {track.artist?.name}
                                            </span>
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

                                        {/* Duration column with queue actions */}
                                        <div className="text-muted-foreground select-none h-full flex items-center justify-end gap-1">
                                            {/* Queue actions - show on hover */}
                                            <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                                    title="Play Next"
                                                    onClick={(e) => {
                                                        e.stopPropagation()
                                                        usePlayerStore.getState().playNext(track)
                                                    }}
                                                >
                                                    <ListPlus className="h-4 w-4" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                                    title="Add to Queue"
                                                    onClick={(e) => {
                                                        e.stopPropagation()
                                                        usePlayerStore.getState().addToQueue(track)
                                                    }}
                                                >
                                                    <Plus className="h-4 w-4" />
                                                </Button>
                                            </div>
                                            <span className="font-variant-numeric tabular-nums text-sm pr-2">
                                                {formatDuration(track.duration)}
                                            </span>
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
