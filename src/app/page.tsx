"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { usePlayerStore } from "@/lib/store"
import { PlusCircle, RefreshCw } from "lucide-react"
import { VirtuosoHandle } from 'react-virtuoso'
import { LetterSelector } from "@/components/ui/letter-selector"
import { cn } from "@/lib/utils"
import { SongsView } from "@/components/views/SongsView"
import { useRouter } from "next/navigation"

// Configuration for Letter Selector positioning
const SCROLL_CONFIG = { start: 185, min: 110 }

export default function Home() {
  const router = useRouter()
  const [loading, setLoading] = React.useState(true)
  const [scanning, setScanning] = React.useState(false)
  const [activeLetter, setActiveLetter] = React.useState('#')
  const {
    playTrack,
    currentTrack,
    isPlaying,
    library,
    setLibrary,
    setCurrentView,
    navigateToArtist,
    setSelectedAlbum
  } = usePlayerStore()

  // Track current scroll index for each view type
  const currentScrollIndexRef = React.useRef<number>(0)
  // Track current scroll offset (pixels) for restoration
  const currentScrollTopRef = React.useRef<number>(0)

  // Refs for virtualization
  const tableVirtuosoRef = React.useRef<VirtuosoHandle>(null)
  const letterSelectorRef = React.useRef<HTMLDivElement>(null)

  // Sync view state
  React.useEffect(() => {
    setCurrentView('songs')
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

  // --- Data Preparation ---
  const allSongs = React.useMemo(() => {
    return library.flatMap(artist => artist.albums.flatMap(album => album.tracks.map(t => ({ ...t, artist: { name: artist.name }, album: { title: album.title } }))))
      .sort((a, b) => a.title.localeCompare(b.title))
  }, [library])

  const handleLetterClick = (letter: string) => {
    setActiveLetter(letter)
    if (tableVirtuosoRef.current) {
      // Find index of first song starting with this letter
      let index = allSongs.findIndex(s => {
        const firstChar = s.title.charAt(0).toUpperCase()
        if (letter === '#') {
          return !/[A-Z]/.test(firstChar)
        }
        return firstChar === letter
      })

      // If no songs for this letter, find the next available letter
      if (index === -1) {
        const letters = '#ABCDEFGHIJKLMNOPQRSTUVWXYZ'
        const startIdx = letters.indexOf(letter)
        for (let i = startIdx + 1; i < letters.length; i++) {
          const nextLetter = letters[i]
          index = allSongs.findIndex(s => {
            const firstChar = s.title.charAt(0).toUpperCase()
            if (nextLetter === '#') {
              return !/[A-Z]/.test(firstChar)
            }
            return firstChar === nextLetter
          })
          if (index !== -1) {
            setActiveLetter(nextLetter)
            break
          }
        }
      }

      if (index !== -1) {
        // Scroll to items[index+1] (the target song)
        tableVirtuosoRef.current.scrollToIndex({ index: index + 1, align: 'start', behavior: 'smooth' })
      }
    }
  }

  // Throttled scroll handler for active letter detection + bar resizing
  const handleScroll = (e: React.UIEvent<HTMLElement>) => {
    const scrollTop = e.currentTarget.scrollTop

    // Track current scroll position for restoration
    currentScrollTopRef.current = scrollTop

    // Resize Letter Selector
    if (letterSelectorRef.current) {
      const top = Math.max(SCROLL_CONFIG.min, SCROLL_CONFIG.start - scrollTop)
      letterSelectorRef.current.style.top = `${top}px`
    }
  }

  // Effect to reset top position on mount
  React.useEffect(() => {
    if (letterSelectorRef.current) {
      letterSelectorRef.current.style.top = `${SCROLL_CONFIG.start}px`
    }
  }, [])

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

  // Navigate to album by ID
  const selectAlbumById = (albumId: string) => {
    for (const artist of library) {
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
          recordLabel: album.recordLabel ?? undefined
        })
        router.push(`/album/${album.id}`)
        return
      }
    }
  }

  // Navigate to artist
  const handleArtistClick = (artistName: string) => {
    navigateToArtist(artistName)
    router.push('/artists')
  }

  // --- Render Helpers ---
  const TableHeaderContent = React.useMemo(() => {
    const HeaderComponent = () => (
      <div className="flex items-center justify-between px-8 py-6 pb-2 pt-2">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight">Library</h1>
          <p className="text-muted-foreground">Songs</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={triggerScan} disabled={scanning} size="sm" className="px-3 sm:px-4">
            <RefreshCw className={cn("h-4 w-4", scanning ? 'animate-spin' : '', scanning ? 'mr-2' : 'sm:mr-2')} />
            <span className={cn("hidden sm:inline", scanning && "inline")}>{scanning ? 'Scanning...' : 'Scan Library'}</span>
          </Button>
          <Button size="sm" className="px-3 sm:px-4">
            <PlusCircle className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Add Folder</span>
          </Button>
        </div>
      </div>
    )
    HeaderComponent.displayName = 'TableHeaderContent'
    return HeaderComponent
  }, [scanning, triggerScan])

  // Custom Components for Virtuoso
  const tableComponents = React.useMemo(() => ({
    Header: TableHeaderContent,
    TableRow: ({ item, context, ...props }: { item: typeof allSongs[number]; context: { playTrack: typeof playTrack; allSongs: typeof allSongs };[key: string]: unknown }) => (
      <tr
        {...(props as React.HTMLAttributes<HTMLTableRowElement>)}
        className="border-b transition-colors hover:bg-muted/50 cursor-pointer group hover:bg-muted/50"
        onClick={() => context.playTrack(item, context.allSongs)}
      />
    ),
  }), [TableHeaderContent])

  const formatDuration = (seconds: number) => {
    if (!seconds) return "0:00"
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }

  return (
    <>
      <SongsView
        songs={allSongs}
        currentTrack={currentTrack}
        isPlaying={isPlaying}
        playTrack={playTrack}
        onSelectAlbum={selectAlbumById}
        onArtistClick={handleArtistClick}
        onScroll={handleScroll}
        tableVirtuosoRef={tableVirtuosoRef}
        tableComponents={tableComponents}
        TableHeaderContent={TableHeaderContent}
        formatDuration={formatDuration}
        onRangeChanged={(range) => {
          const prevIndex = currentScrollIndexRef.current
          currentScrollIndexRef.current = range.startIndex
          // Detect scroll direction
          const scrollingDown = range.startIndex > prevIndex
          const songIndex = scrollingDown
            ? Math.min(range.startIndex + 1, allSongs.length - 1)
            : (range.startIndex > 0 ? range.startIndex : 0)
          const song = allSongs[songIndex]
          if (song) {
            let letter = song.title.charAt(0).toUpperCase()
            if (!/[A-Z]/.test(letter)) letter = '#'
            if (letter !== activeLetter) setActiveLetter(letter)
          }
        }}
      />
      <div
        ref={letterSelectorRef}
        className="absolute right-3 z-50 pointer-events-none"
        style={{ top: `${SCROLL_CONFIG.start}px`, bottom: '90px' }}
      >
        <div className="pointer-events-auto h-full">
          <LetterSelector onLetterClick={handleLetterClick} activeLetter={activeLetter} />
        </div>
      </div>
    </>
  )
}
