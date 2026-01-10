import { Artist, Album } from "@/types/music"
import { Virtuoso, VirtuosoHandle, ListRange } from 'react-virtuoso'
import { AlbumCard } from "@/components/album-card"
import { RefObject, useEffect } from "react"

interface ArtistsViewProps {
    artists: Artist[]
    playAlbum: (album: Album) => void
    onSelectAlbum?: (album: Album, artistName?: string) => void
    onSelectArtist?: (artist: Artist) => void
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    artistsComponents: any
    onScroll: (e: React.UIEvent<HTMLElement>) => void
    virtuosoRef: RefObject<VirtuosoHandle | null>
    targetArtist?: string | null
    onTargetArtistScrolled?: () => void
    onRangeChanged?: (range: ListRange) => void
}

export function ArtistsView({
    artists,
    playAlbum,
    onSelectAlbum,
    onSelectArtist,
    artistsComponents,
    onScroll,
    virtuosoRef,
    targetArtist,
    onTargetArtistScrolled,
    onRangeChanged
}: ArtistsViewProps) {
    // Scroll to target artist when set
    useEffect(() => {
        if (targetArtist && virtuosoRef.current && artists.length > 0) {
            const index = artists.findIndex(a => a.name === targetArtist)
            if (index !== -1) {
                // Use setTimeout to ensure scroll happens after render
                setTimeout(() => {
                    // Use offset of -10 to scroll slightly less, preventing content from being hidden under sticky header
                    virtuosoRef.current?.scrollToIndex({ index, align: 'start', behavior: 'smooth', offset: -10 })
                }, 100)
            }
            // Clear the target after scroll animation completes
            setTimeout(() => {
                onTargetArtistScrolled?.()
            }, 600)
        }
    }, [targetArtist, artists, virtuosoRef, onTargetArtistScrolled])

    return (
        <div className="flex flex-col h-full w-full">
            <div className="flex flex-1 min-h-0 relative overflow-x-hidden">
                <div className="flex-1 min-w-0 h-full">
                    <Virtuoso
                        ref={virtuosoRef}
                        style={{ height: '100%', overscrollBehavior: 'none' }}
                        data={artists}
                        itemContent={(index, artist) => (
                            <div className="mb-8">
                                <h2
                                    className="text-xl font-semibold text-primary/80 sticky top-[56px] z-30 py-2 px-8 bg-background/60 backdrop-blur-md cursor-pointer hover:text-primary transition-colors"
                                    data-letter={artist.name.charAt(0).toUpperCase()}
                                    onClick={() => onSelectArtist?.(artist)}
                                >
                                    {artist.name}
                                </h2>
                                <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-6 mt-4 px-8">
                                    {artist.albums.map(album => (
                                        <AlbumCard key={album.id} album={album} playAlbum={playAlbum} onSelect={onSelectAlbum} artistName={artist.name} />
                                    ))}
                                </div>
                            </div>
                        )}
                        components={artistsComponents}
                        onScroll={onScroll}
                        rangeChanged={onRangeChanged}
                    />
                </div>
            </div>
        </div>
    )
}
