"use client"

import * as React from "react"
import { Suspense } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { usePlayerStore, Track } from "@/lib/store"
import { SearchView } from "@/components/views/SearchView"
import { Album } from "@/types/music"

function SearchPageContent() {
    const searchParams = useSearchParams()
    const router = useRouter()
    const query = searchParams.get('q') || ''

    const {
        playTrack,
        setCurrentView,
        setSearchQuery,
        setSelectedAlbum,
        library,
        setLibrary,
        navigateToArtist
    } = usePlayerStore()

    const [loading, setLoading] = React.useState(library.length === 0)

    // Sync view state and search query
    React.useEffect(() => {
        setCurrentView('search')
        if (query) {
            setSearchQuery(query)
        }
    }, [setCurrentView, setSearchQuery, query])

    // Fetch library if needed
    React.useEffect(() => {
        const fetchLibrary = async () => {
            if (library.length === 0) {
                try {
                    const res = await fetch('/api/library')
                    const data = await res.json()
                    setLibrary(data)
                } catch (err) {
                    console.error("Failed to fetch library", err)
                } finally {
                    setLoading(false)
                }
            } else {
                setLoading(false)
            }
        }
        fetchLibrary()
    }, [library.length, setLibrary])

    const playAlbum = (album: Album, artistName?: string) => {
        if (album.tracks.length > 0) {
            const tracksWithMetadata = album.tracks.map(track => ({
                ...track,
                artist: { name: artistName || 'Unknown Artist' },
                album: { title: album.title }
            }))
            playTrack(tracksWithMetadata[0] as Track, tracksWithMetadata as Track[])
        }
    }

    const selectAlbum = (album: Album, artistName?: string) => {
        setSelectedAlbum({
            id: album.id,
            title: album.title,
            tracks: album.tracks,
            artistName: artistName || 'Unknown Artist',
            description: album.description ?? undefined,
            copyright: album.copyright ?? undefined,
            genre: album.genre ?? undefined,
            releaseDate: album.releaseDate ?? undefined,
            recordLabel: album.recordLabel ?? undefined
        })
        router.push(`/album/${album.id}`)
    }

    const selectArtist = (artistName: string) => {
        navigateToArtist(artistName)
        router.push('/artists')
    }

    if (loading) {
        return (
            <div className="flex h-screen items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
        )
    }

    return (
        <SearchView
            playTrack={playTrack}
            playAlbum={playAlbum}
            onSelectAlbum={selectAlbum}
            onSelectArtist={selectArtist}
        />
    )
}

export default function SearchPage() {
    return (
        <Suspense fallback={
            <div className="flex h-screen items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
        }>
            <SearchPageContent />
        </Suspense>
    )
}
