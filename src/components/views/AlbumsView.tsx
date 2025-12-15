import { Album } from "@/types/music"
import { VirtuosoGrid } from 'react-virtuoso'
import { AlbumCard } from "@/components/album-card"

interface AlbumsViewProps {
    albums: Album[]
    playAlbum: (album: Album) => void
    albumsComponents: any
}

export function AlbumsView({ albums, playAlbum, albumsComponents }: AlbumsViewProps) {
    return (
        <div className="flex flex-col h-full w-full">
            <div className="flex-1 min-h-0 overflow-x-hidden">
                <VirtuosoGrid
                    style={{ height: '100%', overscrollBehavior: 'none' }}
                    data={albums}
                    components={albumsComponents}
                    itemContent={(index, album) => (
                        <AlbumCard key={album.id} album={album} playAlbum={playAlbum} />
                    )}
                />
            </div>
        </div>
    )
}
