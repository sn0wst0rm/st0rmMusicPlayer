import { Album } from "@/types/music"
import { Virtuoso } from 'react-virtuoso'
import { AlbumCard } from "@/components/album-card"

interface AlbumsViewProps {
    groupedAlbums: { letter: string, albums: Album[] }[]
    playAlbum: (album: Album) => void
    albumsComponents: any
    onScroll: (e: React.UIEvent<HTMLElement>) => void
    virtuosoRef: any
}

export function AlbumsView({ groupedAlbums, playAlbum, albumsComponents, onScroll, virtuosoRef }: AlbumsViewProps) {
    return (
        <div className="flex flex-col h-full w-full">
            <div className="flex-1 min-h-0 relative overflow-x-hidden">
                <div className="flex-1 min-w-0 h-full">
                    <Virtuoso
                        ref={virtuosoRef}
                        style={{ height: '100%', overscrollBehavior: 'none' }}
                        data={groupedAlbums}
                        components={albumsComponents}
                        onScroll={onScroll}
                        itemContent={(index, group) => (
                            <div className="mb-8">
                                <h2 className="text-xl font-semibold text-primary/80 sticky top-[56px] z-30 py-2 px-8 bg-background/60 backdrop-blur-md" data-letter={group.letter}>
                                    {group.letter}
                                </h2>
                                <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-6 mt-4 px-8">
                                    {group.albums.map(album => (
                                        <AlbumCard key={album.id} album={album} playAlbum={playAlbum} />
                                    ))}
                                </div>
                            </div>
                        )}
                    />
                </div>
            </div>
        </div>
    )
}
