"use client"

import * as React from "react"
import { useParams, useRouter } from "next/navigation"
import { usePlayerStore } from "@/lib/store"
import { AlbumDetailView } from "@/components/views/AlbumDetailView"

export default function AlbumPage() {
    const params = useParams()
    const router = useRouter()
    const albumId = params.id as string

    const {
        library,
        setLibrary,
        selectedAlbum,
        setSelectedAlbum,
        setCurrentView,
        navigateToArtist
    } = usePlayerStore()

    const [loading, setLoading] = React.useState(!selectedAlbum || selectedAlbum.id !== albumId)

    // Sync view state
    React.useEffect(() => {
        setCurrentView('album')
    }, [setCurrentView])

    // Fetch library if needed and load album
    React.useEffect(() => {
        const loadAlbum = async () => {
            let currentLibrary = library

            // Fetch library if empty
            if (library.length === 0) {
                try {
                    const res = await fetch('/api/library')
                    const data = await res.json()
                    setLibrary(data)
                    currentLibrary = data
                } catch (err) {
                    console.error("Failed to fetch library", err)
                    router.push('/')
                    return
                }
            }

            // Find album by ID
            for (const artist of currentLibrary) {
                const album = artist.albums.find(a => a.id === albumId)
                if (album) {
                    setSelectedAlbum({
                        id: album.id,
                        title: album.title,
                        tracks: album.tracks,
                        artistName: artist.name,
                        description: album.description ?? undefined,
                        copyright: album.copyright ?? undefined,
                        genre: album.genre ?? undefined,
                        releaseDate: album.releaseDate ?? undefined,
                        recordLabel: album.recordLabel ?? undefined,
                        // Use null to indicate "checked but no animated cover" vs undefined for "not yet checked"
                        animatedCoverPath: album.animatedCoverPath ?? null
                    })
                    setLoading(false)
                    return
                }
            }

            // Album not found, redirect to home
            console.warn(`Album ${albumId} not found, redirecting to home`)
            router.push('/')
        }

        // Only load if we don't have the right album
        // animatedCoverPath will be null (checked, no cover) or string (has cover) after first load
        // undefined means we haven't loaded this album's data yet
        if (!selectedAlbum || selectedAlbum.id !== albumId) {
            loadAlbum()
        } else {
            setLoading(false)
        }
    }, [albumId, library, selectedAlbum?.id, setSelectedAlbum, setLibrary, router])

    const handleBack = () => {
        router.back()
    }

    const handleArtistClick = () => {
        if (selectedAlbum) {
            navigateToArtist(selectedAlbum.artistName)
            router.push('/artists')
        }
    }

    if (loading || !selectedAlbum) {
        return (
            <div className="flex h-screen items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
        )
    }

    return (
        <AlbumDetailView
            album={selectedAlbum}
            onBack={handleBack}
            onArtistClick={handleArtistClick}
        />
    )
}
