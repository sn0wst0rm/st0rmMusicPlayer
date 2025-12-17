import { Virtuoso, VirtuosoHandle } from 'react-virtuoso'
import { RefObject } from "react"
import { Play, Clock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Track } from "@/lib/store"

interface SongsViewProps {
    songs: any[]
    currentTrack: Track | null
    isPlaying: boolean
    playTrack: (track: Track, queue: Track[]) => void
    onScroll: (e: React.UIEvent<HTMLElement>) => void
    tableVirtuosoRef: RefObject<VirtuosoHandle | null>
    tableComponents: any
    TableHeaderContent: React.FC
    formatDuration: (seconds: number) => string
}

export function SongsView({
    songs,
    currentTrack,
    isPlaying,
    playTrack,
    onScroll,
    tableVirtuosoRef,
    TableHeaderContent,
    formatDuration
}: SongsViewProps) {
    const items = ["HEADER", ...songs]

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
                                    <div className="sticky top-0 z-20 w-full bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b shadow-sm transition-shadow duration-200">
                                        <div className="grid grid-cols-[3rem_1fr_6rem] md:grid-cols-[3rem_2fr_1.5fr_1.5fr_6rem] gap-4 px-8 py-3 text-sm font-medium text-muted-foreground w-full">
                                            <div className="pl-2">#</div>
                                            <div>Title</div>
                                            <div className="hidden md:block">Artist</div>
                                            <div className="hidden md:block">Album</div>
                                            <div className="flex justify-end pr-2"><Clock className="h-4 w-4" /></div>
                                        </div>
                                    </div>
                                )
                            }

                            const track = item
                            const realIndex = index - 1 // Adjust index for display since 0 is header

                            return (
                                <div className="px-8 w-full group">
                                    <div
                                        className={cn(
                                            "grid grid-cols-[3rem_1fr_6rem] md:grid-cols-[3rem_2fr_1.5fr_1.5fr_6rem] gap-4 py-2 text-sm cursor-pointer items-center rounded-sm transition-colors hover:bg-muted/50",
                                            isPlaying && currentTrack?.id === track.id && "bg-muted/50"
                                        )}
                                        // Use original songs array for playContext to ensure correct queue
                                        onClick={() => playTrack(track, songs)}
                                    >
                                        <div className="pl-2 font-medium tabular-nums text-muted-foreground flex items-center justify-center w-8 h-8 relative">
                                            <span className={cn(
                                                "group-hover:opacity-0 transition-opacity absolute",
                                                isPlaying && currentTrack?.id === track.id && "opacity-0"
                                            )}>
                                                {realIndex + 1}
                                            </span>
                                            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                                <Button
                                                    size="icon"
                                                    variant="ghost"
                                                    className="h-8 w-8 hover:bg-transparent hover:text-primary p-0"
                                                    onClick={(e) => {
                                                        e.stopPropagation()
                                                        playTrack(track, songs)
                                                    }}
                                                >
                                                    <Play className={cn("h-4 w-4 fill-current", isPlaying && currentTrack?.id === track.id && "fill-primary text-primary")} />
                                                </Button>
                                            </div>
                                            {isPlaying && currentTrack?.id === track.id && (
                                                <div className="absolute inset-0 flex items-center justify-center z-10">
                                                    <Play className="h-4 w-4 fill-primary text-primary" />
                                                </div>
                                            )}
                                        </div>

                                        <div className="flex flex-col min-w-0 pr-4">
                                            <span className={cn("truncate font-medium", isPlaying && currentTrack?.id === track.id && "text-primary")}>{track.title}</span>
                                            <span className="text-xs text-muted-foreground md:hidden truncate">{track.artist?.name}</span>
                                        </div>

                                        <div className="hidden md:block text-muted-foreground truncate min-w-0 pr-4">{track.artist?.name}</div>

                                        <div className="hidden md:block text-muted-foreground truncate min-w-0 pr-4">{track.album?.title}</div>

                                        <div className="text-right text-muted-foreground font-variant-numeric tabular-nums pr-2 select-none">
                                            {formatDuration(track.duration)}
                                        </div>
                                    </div>
                                </div>
                            )
                        }}
                        onScroll={onScroll}
                    />
                </div>
            </div>
        </div>
    )
}
