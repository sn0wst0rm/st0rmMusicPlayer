"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { usePlayerStore } from "@/lib/store"
import { PlusCircle, RefreshCw } from "lucide-react"
import { TableVirtuosoHandle, VirtuosoHandle } from 'react-virtuoso'
import { LetterSelector } from "@/components/ui/letter-selector"
import { cn } from "@/lib/utils"
import { Album, Artist } from "@/types/music"
import { SongsView } from "@/components/views/SongsView"
import { ArtistsView } from "@/components/views/ArtistsView"
import { AlbumsView } from "@/components/views/AlbumsView"
import { SearchView } from "@/components/views/SearchView"

function formatDuration(seconds: number) {
  if (!seconds) return "0:00"
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function Home() {
  const [loading, setLoading] = React.useState(true)
  const [scanning, setScanning] = React.useState(false)
  const [activeLetter, setActiveLetter] = React.useState('#')
  const { playTrack, currentView, currentTrack, isPlaying, library, setLibrary } = usePlayerStore()

  // Refs for virtualization
  const tableVirtuosoRef = React.useRef<VirtuosoHandle>(null)
  const virtuosoRef = React.useRef<VirtuosoHandle>(null)
  const letterSelectorRef = React.useRef<HTMLDivElement>(null)

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

  /*
  const allAlbums = React.useMemo(() => {
    return library.flatMap(artist => artist.albums)
  }, [library])
  */

  const groupedAlbums = React.useMemo(() => {
    const albums = library.flatMap(artist =>
      artist.albums.map(album => ({ ...album, artistName: artist.name }))
    ).sort((a, b) => a.title.localeCompare(b.title))
    const groups: { letter: string; albums: Album[] }[] = []
    const letterMap = new Map<string, Album[]>()

    albums.forEach(album => {
      let char = album.title.charAt(0).toUpperCase()
      if (!/[A-Z]/.test(char)) char = '#'
      if (!letterMap.has(char)) letterMap.set(char, [])
      letterMap.get(char)!.push(album)
    })

    // Sort letters: # first, then A-Z
    const sortedLetters = Array.from(letterMap.keys()).sort((a, b) => {
      if (a === '#' && b !== '#') return -1
      if (a !== '#' && b === '#') return 1
      return a.localeCompare(b)
    })

    sortedLetters.forEach(letter => {
      groups.push({ letter, albums: letterMap.get(letter)! })
    })

    return groups
  }, [library])

  const sortedArtists = React.useMemo(() => {
    return [...library].sort((a, b) => a.name.localeCompare(b.name))
  }, [library])

  const handleLetterClick = (letter: string) => {
    setActiveLetter(letter)
    if (currentView === 'songs' && tableVirtuosoRef.current) {
      const index = allSongs.findIndex(s => s.title.toUpperCase().startsWith(letter))
      if (index !== -1) {
        tableVirtuosoRef.current.scrollToIndex({ index, align: 'start', behavior: 'smooth', offset: -24 })
      }
    } else if (currentView === 'artists' && virtuosoRef.current) {
      const index = sortedArtists.findIndex(a => a.name.toUpperCase().startsWith(letter))
      if (index !== -1) {
        virtuosoRef.current.scrollToIndex({ index, align: 'start', behavior: 'smooth', offset: -24 })
      }
    } else if (currentView === 'albums' && virtuosoRef.current) {
      const index = groupedAlbums.findIndex(g => g.letter === letter)
      if (index !== -1) {
        virtuosoRef.current.scrollToIndex({ index, align: 'start', behavior: 'smooth', offset: -24 })
      }
    }
  }

  // Configuration for Letter Selector positioning
  const SCROLL_CONFIG: Record<string, { start: number; min: number }> = {
    songs: { start: 185, min: 110 },
    artists: { start: 150, min: 100 },
    albums: { start: 150, min: 105 },
    default: { start: 150, min: 105 }
  }

  // Throttled scroll handler for active letter detection + bar resizing
  const handleScroll = (e: React.UIEvent<HTMLElement>) => {
    // 1. Resize Letter Selector
    if (letterSelectorRef.current) {
      const scrollTop = e.currentTarget.scrollTop
      const config = SCROLL_CONFIG[currentView] || SCROLL_CONFIG.default
      const top = Math.max(config.min, config.start - scrollTop)
      letterSelectorRef.current.style.top = `${top}px`
    }

    // 2. Detect Active Letter (Artists only)
    if (currentView === 'artists' || currentView === 'albums') {
      // Probe point: Center X, 80px Y (safely inside the 56px+Header zone)
      const x = window.innerWidth / 2
      const y = 80
      const el = document.elementFromPoint(x, y)
      // Traverse up to find the header with data attribute
      const header = el?.closest('[data-letter]') as HTMLElement
      if (header) {
        const letter = header.getAttribute('data-letter')
        if (letter && letter !== activeLetter) {
          setActiveLetter(letter)
        }
      }
    }
  }

  // Effect to reset top position when view changes
  React.useEffect(() => {
    if (letterSelectorRef.current) {
      const config = SCROLL_CONFIG[currentView] || SCROLL_CONFIG.default
      letterSelectorRef.current.style.top = `${config.start}px`
    }
  }, [currentView])

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

  // --- Render Helpers ---

  // Common Header Content - Memoized
  const HeaderContent = React.useMemo(() => {
    const Header = () => (
      <div className="flex items-center justify-between px-8 py-6 pb-2 pt-16"> {/* Matches h-14 (56px) + padding */}
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight">Library</h1>
          <p className="text-muted-foreground capitalize">{currentView}</p>
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
    return Header
  }, [currentView, scanning, triggerScan]) // Dependencies

  const TableHeaderContent = React.useMemo(() => {
    return () => (
      <div className="flex items-center justify-between px-8 py-6 pb-2 pt-2"> {/* Matches h-14 (56px) + padding */}
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight">Library</h1>
          <p className="text-muted-foreground capitalize">{currentView}</p>
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
  }, [currentView, scanning, triggerScan])

  // Custom Components for Virtuoso
  const tableComponents = React.useMemo(() => ({
    Header: TableHeaderContent,
    TableRow: ({ item, context, ...props }: any) => (
      <tr
        {...props}
        className="border-b transition-colors hover:bg-muted/50 cursor-pointer group hover:bg-muted/50"
        onClick={() => context.playTrack(item, context.allSongs)}
      />
    ),
  }), [TableHeaderContent])

  const artistsComponents = React.useMemo(() => ({
    Header: HeaderContent,
    Footer: () => <div className="h-32" />
  }), [HeaderContent])

  const albumsComponents = React.useMemo(() => ({
    Header: HeaderContent,
    Item: (props: any) => <div {...props} className="p-1" />,
    List: React.forwardRef((props, ref) => <div {...props} ref={ref as any} className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6 px-8" />),
    Footer: () => <div className="h-32" />
  }), [HeaderContent])

  const groupedAlbumsComponents = React.useMemo(() => ({
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

  // 1. Search View
  if (currentView === 'search') {
    return (
      <SearchView playTrack={playTrack} playAlbum={playAlbum} />
    )
  }
  // 2. Songs View
  if (currentView === 'songs') {
    const config = SCROLL_CONFIG.songs
    return (
      <>
        <SongsView
          songs={allSongs}
          currentTrack={currentTrack}
          isPlaying={isPlaying}
          playTrack={playTrack}
          onScroll={handleScroll}
          tableVirtuosoRef={tableVirtuosoRef}
          tableComponents={tableComponents}
          TableHeaderContent={TableHeaderContent}
          formatDuration={formatDuration}
        />
        <div
          ref={letterSelectorRef}
          className="absolute right-3 z-50 pointer-events-none"
          style={{ top: `${config.start}px`, bottom: '90px' }}
        >
          <div className="pointer-events-auto h-full">
            <LetterSelector onLetterClick={handleLetterClick} activeLetter={activeLetter} />
          </div>
        </div>
      </>
    )
  }

  // 3. Artists View
  if (currentView === 'artists') {
    const config = SCROLL_CONFIG.artists
    return (
      <>
        <ArtistsView
          artists={sortedArtists}
          playAlbum={playAlbum}
          artistsComponents={artistsComponents}
          onScroll={handleScroll}
          virtuosoRef={virtuosoRef}
        />
        <div
          ref={letterSelectorRef}
          className="absolute right-3 z-50 pointer-events-none"
          style={{ top: `${config.start}px`, bottom: '90px' }}
        >
          <div className="pointer-events-auto h-full">
            <LetterSelector onLetterClick={handleLetterClick} activeLetter={activeLetter} />
          </div>
        </div>
      </>
    )
  }

  // 4. Albums View
  if (currentView === 'albums') {
    const config = SCROLL_CONFIG.albums
    return (
      <>
        <AlbumsView
          groupedAlbums={groupedAlbums}
          playAlbum={playAlbum}
          albumsComponents={groupedAlbumsComponents}
          onScroll={handleScroll}
          virtuosoRef={virtuosoRef}
        />
        <div
          ref={letterSelectorRef}
          className="absolute right-3 z-50 pointer-events-none"
          style={{ top: `${config.start}px`, bottom: '90px' }}
        >
          <div className="pointer-events-auto h-full">
            <LetterSelector onLetterClick={handleLetterClick} activeLetter={activeLetter} />
          </div>
        </div>
      </>
    )
  }

  return null
}
