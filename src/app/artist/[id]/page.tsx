"use client"

import * as React from "react"
import { useParams, useRouter } from "next/navigation"
import { usePlayerStore, SelectedAlbum } from "@/lib/store"
import { ArtistDetailView } from "@/components/views/ArtistDetailView"
import { Album, Artist } from "@/types/music"

export interface ArtistAlbumItem {
    apple_music_id: string
    title: string
    artwork_url?: string
    release_date?: string
    track_count?: number
    is_single: boolean
}

export interface ArtistData {
    apple_music_id: string
    name: string
    artwork_url?: string
    bio?: string
    genre?: string
    origin?: string
    birth_date?: string
    url?: string
    albums: ArtistAlbumItem[]
    singles: ArtistAlbumItem[]
    storefront: string
    // Extended metadata
    is_group?: boolean
    plain_editorial_notes?: string
    // Hero media URLs
    hero_video_url?: string
    hero_static_url?: string
    profile_video_url?: string
}

export default function ArtistPage() {
    const params = useParams()
    const router = useRouter()
    const artistId = params.id as string

    const { library, setLibrary, setCurrentView, setSelectedAlbum, playTrack } = usePlayerStore()

    const [loading, setLoading] = React.useState(true)
    const [fetchingMetadata, setFetchingMetadata] = React.useState(false)
    const [artistData, setArtistData] = React.useState<ArtistData | null>(null)
    const [localArtist, setLocalArtist] = React.useState<Artist | null>(null)
    const [cookiesConfigured, setCookiesConfigured] = React.useState(true)

    // Sync view state
    React.useEffect(() => {
        setCurrentView('artists')
    }, [setCurrentView])

    // Fetch artist data
    React.useEffect(() => {
        const loadArtist = async () => {
            // Find local artist
            let currentLibrary = library
            if (library.length === 0) {
                try {
                    const res = await fetch('/api/library')
                    const data = await res.json()
                    setLibrary(data)
                    currentLibrary = data
                } catch (err) {
                    console.error("Failed to fetch library", err)
                }
            }

            // Try to find artist by appleMusicId first, then by internal id, then by name
            const foundArtist = currentLibrary.find(a =>
                a.appleMusicId === artistId ||
                a.id === artistId ||
                encodeURIComponent(a.name) === artistId
            )
            if (foundArtist) {
                setLocalArtist(foundArtist)
                // Show the page immediately if we have local artist
                setLoading(false)
            }

            // Try to fetch Apple Music data if we have an Apple Music ID
            // Apple Music IDs are numeric strings (no dashes), UUIDs have dashes
            const appleId = foundArtist?.appleMusicId
            if (appleId) {
                setFetchingMetadata(true)
                try {
                    const res = await fetch(`/api/artist/${appleId}`)
                    if (res.ok) {
                        const data = await res.json()
                        setArtistData(data)
                    } else if (res.status === 400) {
                        setCookiesConfigured(false)
                    }
                } catch (err) {
                    console.error('Failed to fetch artist data', err)
                } finally {
                    setFetchingMetadata(false)
                }
            } else {
                // No Apple Music ID available - online features unavailable
                setCookiesConfigured(true) // Cookies may be configured, but we don't have artist ID
            }

            // Only set loading false here if we didn't have a local artist
            if (!foundArtist) {
                setLoading(false)
            }
        }

        loadArtist()
    }, [artistId, library, setLibrary])

    const handleAlbumClick = (album: Album) => {
        const selectedAlbum: SelectedAlbum = {
            id: album.id,
            title: album.title,
            tracks: album.tracks,
            artistName: localArtist?.name || artistData?.name || "Unknown Artist",
            description: album.description ?? undefined,
            copyright: album.copyright ?? undefined,
            genre: album.genre ?? undefined,
            releaseDate: album.releaseDate ?? undefined,
            recordLabel: album.recordLabel ?? undefined,
            animatedCoverPath: album.animatedCoverPath ?? null
        }
        setSelectedAlbum(selectedAlbum)
        router.push(`/album/${album.id}`)
    }

    const handleImportAlbum = (appleAlbumId: string, storefront: string) => {
        const url = `https://music.apple.com/${storefront}/album/_/${appleAlbumId}`
        router.push(`/import?url=${encodeURIComponent(url)}`)
    }

    const handlePlayAll = () => {
        if (!localArtist) return
        const allTracks = localArtist.albums.flatMap(album =>
            album.tracks.map(track => ({
                ...track,
                artist: { name: localArtist.name },
                album: { title: album.title }
            }))
        )
        if (allTracks.length > 0) {
            playTrack(allTracks[0], allTracks)
        }
    }

    const handleShuffle = () => {
        if (!localArtist) return
        const allTracks = localArtist.albums.flatMap(album =>
            album.tracks.map(track => ({
                ...track,
                artist: { name: localArtist.name },
                album: { title: album.title }
            }))
        )
        if (allTracks.length > 0) {
            const shuffled = [...allTracks].sort(() => Math.random() - 0.5)
            playTrack(shuffled[0], shuffled)
        }
    }

    if (loading) {
        return (
            <div className="flex h-screen items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
        )
    }

    // If we have neither local artist nor Apple Music data, show not found
    if (!localArtist && !artistData) {
        return (
            <div className="flex h-screen items-center justify-center flex-col gap-4">
                <p className="text-muted-foreground">Artist not found</p>
                <button
                    onClick={() => router.back()}
                    className="text-primary hover:underline"
                >
                    Go back
                </button>
            </div>
        )
    }

    return (
        <ArtistDetailView
            artistData={artistData}
            localArtist={localArtist}
            cookiesConfigured={cookiesConfigured}
            fetchingMetadata={fetchingMetadata}
            onAlbumClick={handleAlbumClick}
            onImportAlbum={handleImportAlbum}
            onPlayAll={handlePlayAll}
            onShuffle={handleShuffle}
        />
    )
}
