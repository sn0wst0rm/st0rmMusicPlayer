
import * as React from "react"
import { Album } from "@/types/music"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Play } from "lucide-react"
import { cn } from "@/lib/utils"

interface AlbumCardProps {
    album: Album
    playAlbum: (album: Album, artistName?: string) => void
    onSelect?: (album: Album, artistName?: string) => void
    artistName?: string
    className?: string
}

export function AlbumCard({ album, playAlbum, onSelect, artistName, className }: AlbumCardProps) {
    const [isLoading, setIsLoading] = React.useState(true)

    const handleCardClick = () => {
        if (onSelect) {
            onSelect(album, artistName)
        } else {
            // Fallback to playing if no onSelect is provided
            playAlbum(album, artistName)
        }
    }

    const handlePlayClick = (e: React.MouseEvent) => {
        e.stopPropagation()
        playAlbum(album, artistName)
    }

    return (
        <Card className={cn("group overflow-hidden border-none shadow-none bg-transparent hover:bg-card/40 transition-colors cursor-pointer", className)} onClick={handleCardClick}>
            <div className="aspect-square bg-secondary rounded-md mb-3 relative overflow-hidden shadow-sm group-hover:shadow-md transition-all">
                {isLoading && (
                    <Skeleton className="absolute inset-0 w-full h-full bg-primary/10" />
                )}
                <img
                    src={album.tracks[0] ? `/api/cover/${album.tracks[0].id}?size=medium` : ""}
                    alt={album.title}
                    className={cn(
                        "absolute inset-0 w-full h-full object-cover transition-opacity duration-300",
                        isLoading ? "opacity-0" : "opacity-100"
                    )}
                    onLoad={() => setIsLoading(false)}
                    onError={(e) => {
                        e.currentTarget.style.display = 'none'
                    }}
                />
                <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-gray-200 to-gray-300 dark:from-gray-800 dark:to-gray-900 text-muted-foreground font-medium text-2xl -z-10">
                    {album.title.charAt(0)}
                </div>

                <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center z-10">
                    <Button size="icon" className="rounded-full h-14 w-14 bg-primary text-white hover:bg-primary/90 hover:scale-105 shadow-xl transition-all" onClick={handlePlayClick}>
                        <Play className="h-6 w-6" fill="currentColor" />
                    </Button>
                </div>
            </div>
            <div className="space-y-1">
                <h3 className="font-medium leading-none truncate text-sm hover:underline">{album.title}</h3>
                <p className="text-xs text-muted-foreground">{album.tracks.length} {album.tracks.length === 1 ? 'Song' : 'Songs'}</p>
            </div>
        </Card>
    )
}
