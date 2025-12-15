import { Artist, Album } from "@/types/music"
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso'
import { AlbumCard } from "@/components/album-card"
import { RefObject } from "react"

interface ArtistsViewProps {
    artists: Artist[]
    playAlbum: (album: Album) => void
    artistsComponents: any
    onScroll: (e: React.UIEvent<HTMLElement>) => void
    virtuosoRef: RefObject<VirtuosoHandle>
}

export function ArtistsView({ artists, playAlbum, artistsComponents, onScroll, virtuosoRef }: ArtistsViewProps) {
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
                                    className="text-xl font-semibold text-primary/80 sticky top-[56px] z-30 py-2 px-8 bg-background/60 backdrop-blur-md"
                                    data-artist-letter={artist.name.charAt(0).toUpperCase()}
                                >
                                    {artist.name}
                                </h2>
                                <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-6 mt-4 px-8">
                                    {artist.albums.map(album => (
                                        <AlbumCard key={album.id} album={album} playAlbum={playAlbum} />
                                    ))}
                                </div>
                            </div>
                        )}
                        components={artistsComponents}
                        onScroll={onScroll}
                    />
                </div>
            </div>
        </div>
    )
}
