import { VirtuosoGrid, TableVirtuoso, TableVirtuosoHandle } from 'react-virtuoso'
import { RefObject } from "react"
import { Play, Clock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Track } from "@/lib/store"

interface SongsViewProps {
    songs: any[] // Using specific type would be better if exported
    currentTrack: Track | null
    isPlaying: boolean
    playTrack: (track: Track, queue: Track[]) => void
    onScroll: (e: React.UIEvent<HTMLElement>) => void
    tableVirtuosoRef: RefObject<TableVirtuosoHandle>
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
    tableComponents,
    TableHeaderContent,
    formatDuration
}: SongsViewProps) {
    return (
        <div className="flex flex-col h-full w-full">
            <div className="flex-1 min-h-0 relative overflow-x-hidden">
                <div className="flex-1 min-w-0 h-full">
                    <TableVirtuoso
                        ref={tableVirtuosoRef}
                        className="no-scrollbar"
                        data={songs}
                        context={{ playTrack, allSongs: songs }}
                        style={{ height: '100%', overscrollBehavior: 'none' }}
                        fixedHeaderContent={() => (
                            <tr className="bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-[56px] z-20 shadow-sm transition-shadow duration-200">
                                <th className="w-12 p-4 text-left font-medium text-muted-foreground bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 py-3 pl-8">#</th>
                                <th className="p-4 text-left font-medium text-muted-foreground bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 py-3">Title</th>
                                <th className="p-4 text-left font-medium text-muted-foreground hidden md:table-cell bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 py-3">Artist</th>
                                <th className="p-4 text-left font-medium text-muted-foreground hidden md:table-cell bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 py-3">Album</th>
                                <th className="w-24 p-4 text-right font-medium text-muted-foreground bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 py-3 pr-8"><Clock className="h-4 w-4 ml-auto" /></th>
                            </tr>
                        )}
                        itemContent={(index, track) => (
                            <>
                                <td className="p-4 align-middle font-medium tabular-nums text-muted-foreground w-12 py-2 pl-8">
                                    <div className="relative w-8 h-8 flex items-center justify-center group">
                                        <span className={cn(
                                            "group-hover:opacity-0 transition-opacity w-full text-left",
                                            isPlaying && currentTrack?.id === track.id && "text-primary font-bold opacity-0"
                                        )}>
                                            {index + 1}
                                        </span>
                                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                            <Button
                                                size="icon"
                                                variant="ghost"
                                                className="h-8 w-8 hover:bg-transparent hover:text-primary"
                                                onClick={() => playTrack(track, songs)}
                                            >
                                                <Play className={cn("h-4 w-4 fill-current", isPlaying && currentTrack?.id === track.id && "fill-primary text-primary")} />
                                            </Button>
                                        </div>
                                        {isPlaying && currentTrack?.id === track.id && (
                                            <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                                                <Play className="h-5 w-5 fill-primary text-primary" />
                                            </div>
                                        )}
                                    </div>
                                </td>
                                <td className="p-4 align-middle font-medium py-2">
                                    <div className="flex flex-col">
                                        <span className="line-clamp-1 text-sm">{track.title}</span>
                                        <span className="text-xs text-muted-foreground md:hidden line-clamp-1">{track.artist?.name}</span>
                                    </div>
                                </td>
                                <td className="p-4 align-middle hidden md:table-cell text-muted-foreground text-sm line-clamp-1 max-w-[200px] py-2">{track.artist?.name}</td>
                                <td className="p-4 align-middle hidden md:table-cell text-muted-foreground text-sm line-clamp-1 max-w-[200px] py-2">{track.album?.title}</td>
                                <td className="p-4 align-middle text-right text-muted-foreground text-sm font-variant-numeric tabular-nums pr-8 py-2">
                                    {formatDuration(track.duration)}
                                </td>
                            </>
                        )}
                        components={{
                            ...tableComponents,
                            // Wrap HeaderContent for Table
                            Table: (props: any) => (
                                <table {...props} className="w-full caption-bottom text-sm border-collapse mb-32">
                                    <caption className="caption-top p-0 m-0 w-full block text-left">
                                        <TableHeaderContent />
                                    </caption>
                                    {props.children}
                                </table>
                            )
                        }}
                        onScroll={onScroll}
                    />
                </div>
            </div>
        </div>
    )
}
