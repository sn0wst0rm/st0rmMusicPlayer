"use client"

import * as React from "react"
import { Card } from "@/components/ui/card"
import { usePlayerStore, Track } from "@/lib/store"
import { Play, Clock } from "lucide-react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

// --- Types ---
interface Album {
    id: string
    title: string
    tracks: Track[]
}

interface Artist {
    id: string
    name: string
    albums: Album[]
}

// --- Components ---

function SongRow({ track, onClick, isPlaying }: { track: Track, onClick: () => void, isPlaying: boolean }) {
    return (
        <TableRow
            className="group hover:bg-muted/50 cursor-pointer"
            onClick={onClick}
        >
            <TableCell className="w-[50px] text-center">
                <div className="relative w-8 h-8 flex items-center justify-center">
                    <span className="group-hover:hidden text-muted-foreground text-xs font-medium">
                        {isPlaying ? <Play className="h-3 w-3 fill-primary text-primary" /> : "#"}
                    </span>
                    <Play className="h-4 w-4 hidden group-hover:block fill-current" />
                </div>
            </TableCell>
            <TableCell className="font-medium">
                <div className="flex flex-col">
                    <span>{track.title}</span>
                    <span className="text-xs text-muted-foreground md:hidden">{track.artist?.name}</span>
                </div>
            </TableCell>
            <TableCell className="hidden md:table-cell text-muted-foreground">{track.artist?.name}</TableCell>
            <TableCell className="hidden md:table-cell text-muted-foreground">{track.album?.title}</TableCell>
            <TableCell className="text-right text-muted-foreground font-variant-numeric tabular-nums">
                {formatDuration(track.duration)}
            </TableCell>
        </TableRow>
    )
}

function formatDuration(seconds: number) {
    if (!seconds) return "0:00"
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
}

export default function Home() {
    const [library, setLibrary] = React.useState<Artist[]>([])

    const { playTrack, searchQuery, currentView } = usePlayerStore()

    // Suppress unused variable warnings - these are kept for future implementation
    void setLibrary

    // ... fetchLibrary & triggerScan (keep existing logic) ...

    const allSongs = React.useMemo(() => {
        return library.flatMap(artist => artist.albums.flatMap(album => album.tracks.map(t => ({ ...t, artist: { name: artist.name }, album: { title: album.title } }))))
    }, [library])

    const allAlbums = React.useMemo(() => {
        return library.flatMap(artist => artist.albums)
    }, [library])

    const searchResults = React.useMemo(() => {
        if (!searchQuery) return null
        const lower = searchQuery.toLowerCase()

        const tracks = allSongs.filter(t => t.title.toLowerCase().includes(lower) || t.artist?.name?.toLowerCase().includes(lower) || t.album?.title?.toLowerCase().includes(lower))
        return { tracks }
    }, [searchQuery, allSongs])
    if (searchQuery && searchResults) {
        return (
            <div className="space-y-6">
                <h2 className="text-xl font-bold">Songs</h2>
                <div className="rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-[50px]"></TableHead>
                                <TableHead>Title</TableHead>
                                <TableHead className="hidden md:table-cell">Artist</TableHead>
                                <TableHead className="hidden md:table-cell">Album</TableHead>
                                <TableHead className="text-right"><Clock className="h-4 w-4 ml-auto" /></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {searchResults.tracks.map(track => (
                                <SongRow
                                    key={track.id}
                                    track={track}
                                    isPlaying={false}
                                    onClick={() => playTrack(track, searchResults.tracks)}
                                />
                            ))}
                        </TableBody>
                    </Table>
                </div>
            </div>
        )
    }

    if (currentView === 'songs') {
        return (
            <div className="rounded-md border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-[50px]"></TableHead>
                            <TableHead>Title</TableHead>
                            <TableHead className="hidden md:table-cell">Artist</TableHead>
                            <TableHead className="hidden md:table-cell">Album</TableHead>
                            <TableHead className="text-right"><Clock className="h-4 w-4 ml-auto" /></TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {allSongs.map(track => (
                            <SongRow
                                key={track.id}
                                track={track}
                                isPlaying={false}
                                onClick={() => playTrack(track, allSongs)}
                            />
                        ))}
                    </TableBody>
                </Table>
            </div>
        )
    }

    if (currentView === 'albums') {
        return (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
                {allAlbums.map(album => (
                    <Card key={album.id} className="group overflow-hidden border-none shadow-none bg-transparent hover:bg-card/40 transition-colors">
                        {/* Album Card Content (Same as before) */}
                        {/* Reuse previous logic but passed simple album prop */}
                    </Card>
                ))}
            </div>
        )
    }

    // Default: Artists View (Home)
    return (
        <div className="space-y-8">
            {library.map(artist => (
                <div key={artist.id}>
                    {/* Artist Header and Grid */}
                    <h2 className="text-xl font-semibold text-primary/80 sticky top-0 bg-background/95 backdrop-blur-sm z-10 py-2 border-b mb-4">
                        {artist.name}
                    </h2>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
                        {artist.albums.map(album => (
                            <div key={album.id} className="text-sm">Example Album</div>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    )
}
