"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { usePlayerStore } from "@/lib/store"
import { PlusCircle, RefreshCw } from "lucide-react"
import { VirtuosoHandle } from 'react-virtuoso'
import { LetterSelector } from "@/components/ui/letter-selector"
import { cn } from "@/lib/utils"
import { Album } from "@/types/music"
import { SongsView } from "@/components/views/SongsView"
import { ArtistsView } from "@/components/views/ArtistsView"
import { AlbumsView } from "@/components/views/AlbumsView"
import { SearchView } from "@/components/views/SearchView"
import { AlbumDetailView } from "@/components/views/AlbumDetailView"
import { PlaylistView } from "@/components/views/PlaylistView"
import { ImportView } from "@/components/views/ImportView"

function formatDuration(seconds: number) {
  if (!seconds) return "0:00"
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

// Configuration for Letter Selector positioning (at module level to avoid recreating)
const SCROLL_CONFIG: Record<string, { start: number; min: number }> = {
  songs: { start: 185, min: 110 },
  artists: { start: 150, min: 100 },
  albums: { start: 150, min: 105 },
  default: { start: 150, min: 105 }
}

export default function Home() {
  const [loading, setLoading] = React.useState(true)
  const [scanning, setScanning] = React.useState(false)
  const [activeLetter, setActiveLetter] = React.useState('#')
  const { playTrack, currentView, currentTrack, isPlaying, library, setLibrary, selectedAlbum, clearSelectedAlbum, setCurrentView, setSelectedAlbum, previousNavigation, setPreviousNavigation, navigateToArtist, targetArtist, setTargetArtist, selectedPlaylistId, setSelectedPlaylistId } = usePlayerStore()

  // Track current scroll index for each view type
  const currentScrollIndexRef = React.useRef<number>(0)
  // Track current scroll offset (pixels) for restoration
  const currentScrollTopRef = React.useRef<number>(0)

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
        // Scroll to items[index+1] (the target song) - Virtuoso positions it right below sticky header
        tableVirtuosoRef.current.scrollToIndex({ index: index + 1, align: 'start', behavior: 'smooth' })
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

  // Throttled scroll handler for active letter detection + bar resizing
  const handleScroll = (e: React.UIEvent<HTMLElement>) => {
    const scrollTop = e.currentTarget.scrollTop

    // Track current scroll position for restoration
    currentScrollTopRef.current = scrollTop

    // 1. Resize Letter Selector
    if (letterSelectorRef.current) {
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

  const selectAlbum = (album: Album, artistName?: string) => {
    // Save current view and scroll position before navigating to album
    // Stop momentum scrolling by pinning the scroll position
    if (currentView !== 'album') {
      const scroller = document.querySelector('[data-virtuoso-scroller="true"]') as HTMLElement | null
      let scrollTop = currentScrollTopRef.current
      if (scroller) {
        // Read current position and immediately pin it to stop momentum scrolling
        scrollTop = scroller.scrollTop
        scroller.scrollTop = scrollTop
      }
      console.log('[selectAlbum] Saving index:', currentScrollIndexRef.current, 'from view:', currentView)
      setPreviousNavigation({
        view: currentView as 'artists' | 'albums' | 'songs' | 'search',
        scrollIndex: currentScrollIndexRef.current,
        scrollTop
      })
    }
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
  }

  // Look up album by ID from library and navigate to it
  const selectAlbumById = (albumId: string) => {
    // Save current view and scroll position before navigating
    // Stop momentum scrolling by pinning the scroll position
    if (currentView !== 'album') {
      const scroller = document.querySelector('[data-virtuoso-scroller="true"]') as HTMLElement | null
      let scrollTop = currentScrollTopRef.current
      if (scroller) {
        // Read current position and immediately pin it to stop momentum scrolling
        scrollTop = scroller.scrollTop
        scroller.scrollTop = scrollTop
      }
      setPreviousNavigation({
        view: currentView as 'artists' | 'albums' | 'songs' | 'search',
        scrollIndex: currentScrollIndexRef.current,
        scrollTop
      })
    }
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
        return
      }
    }
  }

  // Handle back navigation from album view
  const handleAlbumBack = React.useCallback(() => {
    clearSelectedAlbum()
    if (previousNavigation) {
      const targetView = previousNavigation.view
      const savedScrollTop = previousNavigation.scrollTop

      // Clear navigation state first
      setPreviousNavigation(null)
      setCurrentView(targetView)

      // Restore scroll position after Virtuoso fully initializes
      // Use only pixel-based restoration with sufficient delay for Virtuoso to stabilize
      if (savedScrollTop !== undefined && savedScrollTop > 0) {
        // Multiple attempts to ensure scroll sticks after Virtuoso stabilizes
        const attemptRestore = (attempt: number) => {
          const scroller = document.querySelector('[data-virtuoso-scroller="true"]')
          if (scroller) {
            console.log('[handleAlbumBack] Restoring scroll to:', savedScrollTop, 'attempt:', attempt)
            scroller.scrollTop = savedScrollTop
            // Verify it stuck and retry if needed
            if (attempt < 2 && Math.abs(scroller.scrollTop - savedScrollTop) > 10) {
              setTimeout(() => attemptRestore(attempt + 1), 200)
            }
          } else if (attempt < 3) {
            setTimeout(() => attemptRestore(attempt + 1), 100)
          }
        }
        // Wait for Virtuoso to fully initialize before first attempt
        setTimeout(() => attemptRestore(0), 300)
      }
    } else {
      setCurrentView('albums')
    }
  }, [clearSelectedAlbum, setCurrentView, previousNavigation, setPreviousNavigation])

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
    const HeaderComponent = () => (
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
    HeaderComponent.displayName = 'TableHeaderContent'
    return HeaderComponent
  }, [currentView, scanning, triggerScan])

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

  const artistsComponents = React.useMemo(() => ({
    Header: HeaderContent,
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

  // 0. Album Detail View
  if (currentView === 'album' && selectedAlbum) {
    return (
      <AlbumDetailView
        album={selectedAlbum}
        onBack={handleAlbumBack}
        onArtistClick={() => navigateToArtist(selectedAlbum.artistName)}
      />
    )
  }

  // 0.5. Playlist View
  if (currentView === 'playlist' && selectedPlaylistId) {
    return (
      <PlaylistView
        playlistId={selectedPlaylistId}
        onBack={() => {
          setSelectedPlaylistId(null)
          setCurrentView('songs')
        }}
      />
    )
  }

  // 0.6. Import View
  if (currentView === 'import') {
    return <ImportView />
  }

  // 1. Search View
  if (currentView === 'search') {
    return (
      <SearchView playTrack={playTrack} playAlbum={playAlbum} onSelectAlbum={selectAlbum} />
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
          onSelectAlbum={selectAlbumById}
          onArtistClick={navigateToArtist}
          onScroll={handleScroll}
          tableVirtuosoRef={tableVirtuosoRef}
          tableComponents={tableComponents}
          TableHeaderContent={TableHeaderContent}
          formatDuration={formatDuration}
          onRangeChanged={(range) => {
            const prevIndex = currentScrollIndexRef.current
            currentScrollIndexRef.current = range.startIndex
            // Detect scroll direction: scrolling down if startIndex increased
            const scrollingDown = range.startIndex > prevIndex
            // When scrolling down, Virtuoso's startIndex lags by 1, so compensate
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
          onSelectAlbum={selectAlbum}
          albumsComponents={groupedAlbumsComponents}
          onScroll={handleScroll}
          virtuosoRef={virtuosoRef}
          onRangeChanged={(range) => { currentScrollIndexRef.current = range.startIndex }}
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
