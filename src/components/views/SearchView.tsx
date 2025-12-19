import * as React from "react"
import { usePlayerStore, Track } from "@/lib/store"
import { searchLibrary, SongSearchResult, AlbumSearchResult, ArtistSearchResult } from "@/lib/search"
import { Album } from "@/types/music"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { AlbumCard } from "@/components/album-card"
import { Play } from "lucide-react"
import { cn } from "@/lib/utils"

interface SearchViewProps {
    playTrack: (track: Track, queue: Track[]) => void
    playAlbum: (album: Album) => void
    onSelectAlbum?: (album: Album, artistName?: string) => void
}

// Extracted component to allow proper hook usage
function SongRow({ song, allSongs, playTrack }: {
    song: Track
    allSongs: Track[]
    playTrack: (track: Track, queue: Track[]) => void
}) {
    const [isLoading, setIsLoading] = React.useState(true)

    return (
        <div
            className="group flex items-center gap-4 rounded-md py-2 pr-2 hover:bg-neutral-100/50 dark:hover:bg-neutral-800/50 transition-colors cursor-pointer"
            onClick={() => playTrack(song, allSongs)}
        >
            <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-secondary overflow-hidden">
                {isLoading && (
                    <Skeleton className="absolute inset-0 w-full h-full bg-primary/10" />
                )}
                <img
                    src={`/api/cover/${song.id}?size=small`}
                    alt={song.album?.title}
                    className={cn(
                        "absolute inset-0 w-full h-full object-cover transition-opacity duration-300",
                        isLoading ? "opacity-0" : "opacity-100"
                    )}
                    onLoad={() => setIsLoading(false)}
                    onError={(e) => {
                        e.currentTarget.style.display = 'none'
                    }}
                />
                <div className="absolute inset-0 bg-primary/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center z-10">
                    <Play className="h-4 w-4 text-white fill-white" />
                </div>
            </div>
            <div className="flex flex-col gap-0.5 overflow-hidden">
                <span className="font-medium truncate">{song.title}</span>
                <span className="text-xs text-muted-foreground truncate">
                    {song.artist?.name} • {song.album?.title}
                </span>
            </div>
            <div className="ml-auto text-xs text-muted-foreground">
                {formatDuration(song.duration)}
            </div>
        </div>
    )
}

export function SearchView({ playTrack, playAlbum, onSelectAlbum }: SearchViewProps) {
    const { searchQuery, library, setCurrentView } = usePlayerStore()

    // Use the advanced search engine with fuzzy matching and relevance scoring
    const searchResults = React.useMemo(() => {
        if (!searchQuery) return { songs: [], albums: [], artists: [] }

        const results = searchLibrary(searchQuery, library)

        // Extract items from search results (they're wrapped with score metadata)
        // Results are already sorted by relevance score
        return {
            songs: results.songs.map((r: SongSearchResult) => r.item),
            albums: results.albums.map((r: AlbumSearchResult) => r.item),
            artists: results.artists.map((r: ArtistSearchResult) => r.item)
        }
    }, [searchQuery, library])

    if (!searchQuery) {
        return (
            <div className="flex flex-col h-full items-center justify-center p-8 text-center text-muted-foreground">
                <p>Type something to search...</p>
            </div>
        )
    }

    if (searchResults.songs.length === 0 && searchResults.albums.length === 0 && searchResults.artists.length === 0) {
        return (
            <div className="flex flex-col h-full items-center justify-center p-8 text-center">
                <h2 className="text-xl font-semibold mb-2">No results found</h2>
                <p className="text-muted-foreground">Try searching for a different song, album, or artist.</p>
            </div>
        )
    }

    return (
        <ScrollArea className="h-full">
            <div className="px-8 pt-16 pb-32 space-y-8">
                <div className="space-y-1">
                    <h1 className="text-3xl font-bold tracking-tight">Search</h1>
                    <p className="text-muted-foreground">Results for &quot;{searchQuery}&quot;</p>
                </div>

                {searchResults.songs.length > 0 && (
                    <div className="space-y-4">
                        <h2 className="text-xl font-semibold tracking-tight">Songs</h2>
                        <Separator />
                        <div className="grid gap-1">
                            {searchResults.songs.map((song) => (
                                <SongRow
                                    key={song.id}
                                    song={song}
                                    allSongs={searchResults.songs}
                                    playTrack={playTrack}
                                />
                            ))}
                        </div>
                    </div>
                )}

                {searchResults.albums.length > 0 && (
                    <div className="space-y-4">
                        <h2 className="text-xl font-semibold tracking-tight">Albums</h2>
                        <Separator />
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
                            {searchResults.albums.map(album => (
                                <AlbumCard
                                    key={album.id}
                                    album={album}
                                    artistName={album.artistName}
                                    playAlbum={playAlbum}
                                    onSelect={onSelectAlbum}
                                    className="w-full"
                                />
                            ))}
                        </div>
                    </div>
                )}

                {searchResults.artists.length > 0 && (
                    <div className="space-y-4">
                        <h2 className="text-xl font-semibold tracking-tight">Artists</h2>
                        <Separator />
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
                            {searchResults.artists.map(artist => (
                                <div
                                    key={artist.id}
                                    className="group relative flex flex-col gap-3 p-4 hover:bg-neutral-100/50 dark:hover:bg-neutral-800/50 rounded-lg transition-colors cursor-pointer"
                                    onClick={() => setCurrentView('artists')}
                                >
                                    <div className="aspect-square w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
                                        <div className="flex h-full w-full items-center justify-center text-4xl text-muted-foreground">
                                            {artist.name.charAt(0)}
                                        </div>
                                    </div>
                                    <div className="text-center">
                                        <span className="font-semibold truncate block">{artist.name}</span>
                                        <span className="text-xs text-muted-foreground">Artist</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </ScrollArea>
    )
}

function formatDuration(seconds: number) {
    if (!seconds) return "0:00"
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
}
