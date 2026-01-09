"use client"

import * as React from "react"
import { Virtuoso, VirtuosoHandle } from "react-virtuoso"
import { Button } from "@/components/ui/button"
import { RefreshCw, PlusCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import { usePlayerStore } from "@/lib/store"
import { ArtistsView } from "@/components/views/ArtistsView"
import { LetterSelector } from "@/components/ui/letter-selector"
import { Album } from "@/types/music"
import { useRouter } from "next/navigation"

export default function ArtistsPage() {
    const router = useRouter()
    const [loading, setLoading] = React.useState(true)
    const [scanning, setScanning] = React.useState(false)
    const [activeLetter, setActiveLetter] = React.useState('A')
    const { library, setLibrary, playTrack, targetArtist, setTargetArtist, setSelectedAlbum, setCurrentView } = usePlayerStore()

    const virtuosoRef = React.useRef<VirtuosoHandle>(null)
    const letterSelectorRef = React.useRef<HTMLDivElement>(null)
    const currentScrollIndexRef = React.useRef<number>(0)

    // Sync view state
    React.useEffect(() => {
        setCurrentView('artists')
    }, [setCurrentView])

    const fetchLibrary = React.useCallback(async () => {
        try {
            setLoading(true)
            const res = await fetch('/api/library')
            const data = await res.json()
            setLibrary(data)
        } catch (err) {
            console.error("Failed to fetch library", err)
        } finally {
            setLoading(false)
        }
    }, [setLibrary])

    React.useEffect(() => {
        fetchLibrary()
    }, [fetchLibrary])

    const triggerScan = React.useCallback(async () => {
        setScanning(true)
        try {
            await fetch('/api/scan', { method: 'POST' })
            await fetchLibrary()
        } finally {
            setScanning(false)
        }
    }, [fetchLibrary])

    const sortedArtists = React.useMemo(() => {
        return [...library].sort((a, b) => a.name.localeCompare(b.name))
    }, [library])

    const playAlbum = (album: Album, artistName?: string) => {
        if (album.tracks.length > 0) {
            const tracksWithMetadata = album.tracks.map(track => ({
                ...track,
                artist: { name: artistName || 'Unknown Artist' },
                album: { title: album.title }
            }))
            playTrack(tracksWithMetadata[0], tracksWithMetadata)
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

    const handleLetterClick = (letter: string) => {
        setActiveLetter(letter)
        if (virtuosoRef.current) {
            const index = sortedArtists.findIndex(a => a.name.toUpperCase().startsWith(letter))
            if (index !== -1) {
                virtuosoRef.current.scrollToIndex({ index, align: 'start', behavior: 'smooth', offset: -24 })
            }
        }
    }

    const handleScroll = (e: React.UIEvent<HTMLElement>) => {
        const scrollTop = e.currentTarget.scrollTop
        if (letterSelectorRef.current) {
            const top = Math.max(100, 150 - scrollTop)
            letterSelectorRef.current.style.top = `${top}px`
        }
        // Detect active letter from DOM
        const x = window.innerWidth / 2
        const y = 80
        const el = document.elementFromPoint(x, y)
        const header = el?.closest('[data-letter]') as HTMLElement
        if (header) {
            const letter = header.getAttribute('data-letter')
            if (letter && letter !== activeLetter) {
                setActiveLetter(letter)
            }
        }
    }

    const HeaderContent = React.useMemo(() => {
        const Header = () => (
            <div className="flex items-center justify-between px-8 py-6 pb-2 pt-16">
                <div className="space-y-1">
                    <h1 className="text-3xl font-bold tracking-tight">Library</h1>
                    <p className="text-muted-foreground">Artists</p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={triggerScan} disabled={scanning} size="sm" className="px-3 sm:px-4">
                        <RefreshCw className={cn("h-4 w-4", scanning ? 'animate-spin' : '', scanning ? 'mr-2' : 'sm:mr-2')} />
                        <span className={cn("hidden sm:inline", scanning && "inline")}>{scanning ? 'Scanning...' : 'Scan Library'}</span>
                    </Button>
                    <Button size="sm" className="px-3 sm:px-4" onClick={() => router.push('/import?focus=url')}>
                        <PlusCircle className="h-4 w-4 sm:mr-2" />
                        <span className="hidden sm:inline">Import Media...</span>
                    </Button>
                </div>
            </div>
        )
        return Header
    }, [scanning, triggerScan])

    const artistsComponents = React.useMemo(() => ({
        Header: HeaderContent,
        Footer: () => <div className="h-32" />
    }), [HeaderContent])

    if (loading) {
        return (
            <div className="flex h-screen items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
        )
    }

    return (
        <>
            <ArtistsView
                artists={sortedArtists}
                playAlbum={playAlbum}
                onSelectAlbum={selectAlbum}
                artistsComponents={artistsComponents}
                onScroll={handleScroll}
                virtuosoRef={virtuosoRef}
                targetArtist={targetArtist}
                onTargetArtistScrolled={() => setTargetArtist(null)}
                onRangeChanged={(range) => { currentScrollIndexRef.current = range.startIndex }}
            />
            <div
                ref={letterSelectorRef}
                className="absolute right-3 z-50 pointer-events-none"
                style={{ top: '150px', bottom: '90px' }}
            >
                <div className="pointer-events-auto h-full">
                    <LetterSelector onLetterClick={handleLetterClick} activeLetter={activeLetter} />
                </div>
            </div>
        </>
    )
}
