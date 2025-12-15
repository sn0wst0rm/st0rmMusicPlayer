"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { usePlayerStore, Track } from "@/lib/store"
import { PlayCircle, PlusCircle, RefreshCw, Play, Clock } from "lucide-react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"
import { LetterSelector } from "@/components/ui/letter-selector"

interface Album {
  id: string
  title: string
  tracks: Track[]
}

interface Artist {
  id: string
  name: string
  albums: Album[]
}

function formatDuration(seconds: number) {
  if (!seconds) return "0:00"
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function SongRow({ track, onClick, isPlaying, id, ...props }: { track: Track, onClick: () => void, isPlaying: boolean, id?: string } & React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <TableRow
      id={id}
      className="group hover:bg-muted/50 cursor-pointer border-b border-border/50"
      onClick={onClick}
      {...props}
    >
      <TableCell className="w-[50px] p-0 pl-2">
        <div className="relative w-10 h-10 flex items-center justify-center rounded-md overflow-hidden bg-secondary group/image">
          <img
            src={`/api/cover/${track.id}?size=small`}
            alt={track.title}
            className="w-full h-full object-cover"
            onError={(e) => { e.currentTarget.style.display = 'none' }}
          />
          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/image:opacity-100 transition-opacity flex items-center justify-center">
            <Play className="h-5 w-5 fill-white text-white" />
          </div>
          {isPlaying && (
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
              <Play className="h-5 w-5 fill-primary text-primary" />
            </div>
          )}
        </div>
      </TableCell>
      <TableCell className="font-medium">
        <div className="flex flex-col">
          <span className="line-clamp-1 text-sm">{track.title}</span>
          <span className="text-xs text-muted-foreground md:hidden line-clamp-1">{track.artist?.name}</span>
        </div>
      </TableCell>
      <TableCell className="hidden md:table-cell text-muted-foreground text-sm line-clamp-1 max-w-[200px]">{track.artist?.name}</TableCell>
      <TableCell className="hidden md:table-cell text-muted-foreground text-sm line-clamp-1 max-w-[200px]">{track.album?.title}</TableCell>
      <TableCell className="text-right text-muted-foreground text-sm font-variant-numeric tabular-nums pr-4">
        {formatDuration(track.duration)}
      </TableCell>
    </TableRow>
  )
}

function AlbumCard({ album, playAlbum }: { album: Album, playAlbum: (a: Album) => void }) {
  return (
    <Card className="group overflow-hidden border-none shadow-none bg-transparent hover:bg-card/40 transition-colors cursor-pointer" onClick={() => playAlbum(album)}>
      <div className="aspect-square bg-secondary rounded-md mb-3 relative overflow-hidden shadow-sm group-hover:shadow-md transition-all">
        <img
          src={album.tracks[0] ? `/api/cover/${album.tracks[0].id}?size=medium` : ""}
          alt={album.title}
          className="absolute inset-0 w-full h-full object-cover transition-opacity duration-300"
          onError={(e) => { e.currentTarget.style.display = 'none' }}
        />
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-gray-200 to-gray-300 dark:from-gray-800 dark:to-gray-900 text-muted-foreground font-medium text-2xl -z-10">
          {album.title.charAt(0)}
        </div>

        <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center z-10">
          <Button size="icon" className="rounded-full h-12 w-12 bg-primary text-primary-foreground hover:bg-primary/90 shadow-xl scale-95 group-hover:scale-100 transition-transform">
            <PlayCircle className="h-12 w-12" />
          </Button>
        </div>
      </div>
      <div className="space-y-1">
        <h3 className="font-medium leading-none truncate text-sm">{album.title}</h3>
        <p className="text-xs text-muted-foreground">{album.tracks.length} {album.tracks.length === 1 ? 'Song' : 'Songs'}</p>
      </div>
    </Card>
  )
}

export default function Home() {
  const [library, setLibrary] = React.useState<Artist[]>([])
  const [loading, setLoading] = React.useState(true)
  const [scanning, setScanning] = React.useState(false)
  const [selectorTop, setSelectorTop] = React.useState(208)
  const [activeLetter, setActiveLetter] = React.useState('#')
  const { playTrack, searchQuery, currentView, currentTrack, isPlaying } = usePlayerStore()

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
  }, [])

  React.useEffect(() => {
    fetchLibrary()
  }, [fetchLibrary])

  React.useEffect(() => {
    // Find the scrollable container. 
    // In our layout, SidebarInset usually renders a main element or a div with overflow-auto.
    // Based on debugging, we look for 'main.overflow-auto' or just the closest scrollable parent.
    // Since this component is inside the SidebarInset (children), we can try to find the scrolling parent.

    const scrollContainer = document.querySelector('main.overflow-y-auto') || document.querySelector('.overflow-y-auto') || document.querySelector('main')

    if (!scrollContainer) {
      console.warn("Could not find scroll container")
      return
    }

    const handleScroll = () => {
      // 208 is top-52, 80 is roughly top-20
      const currentScroll = scrollContainer.scrollTop
      const newTop = Math.max(80, 208 - currentScroll)
      setSelectorTop(newTop)

      // Sync active letter
      // Find all anchors
      const anchors = Array.from(document.querySelectorAll('[id^="song-"], [id^="artist-"]')) as HTMLElement[]

      // We want the last anchor that is above the "active line".
      // The active line is where we consider the "current" content to start.
      // Since we have a sticky header and some top padding, this is roughly 180px-200px down.
      // Refined: Songs has 60px header. Artists has 60px + ~50px header.
      const offset = currentView === 'artists' ? 120 : 80
      const containerRect = scrollContainer.getBoundingClientRect()

      let currentActive = '#'
      for (const anchor of anchors) {
        // Use getBoundingClientRect for reliability relative to viewport/container
        const rect = anchor.getBoundingClientRect()
        // Calculate distance from top of scroll container
        // If anchor is inside container, rect.top - containerRect.top is the distance from the top visible edge
        const relativeTop = rect.top - containerRect.top

        // If relativeTop is <= offset, it means the element is at or above the "active line"
        if (relativeTop <= offset) {
          const letter = anchor.getAttribute('data-letter')
          if (letter) currentActive = letter
        } else {
          // As soon as we find one BELOW the line, we stop. The previous one remains the winner.
          break
        }
      }
      setActiveLetter(currentActive)
    }

    // Initial check (in case page is already scrolled somehow or refreshed)
    handleScroll()

    scrollContainer.addEventListener('scroll', handleScroll, { passive: true })
    return () => scrollContainer.removeEventListener('scroll', handleScroll)
  }, [currentView]) // Added currentView to dependencies

  const triggerScan = async () => {
    setScanning(true)
    try {
      await fetch('/api/scan', { method: 'POST' })
      setTimeout(() => {
        fetchLibrary()
        setScanning(false)
      }, 2000)
    } catch (err) {
      console.error("Scan trigger failed", err)
      setScanning(false)
    }
  }

  const playAlbum = (album: Album) => {
    if (album.tracks.length > 0) {
      playTrack(album.tracks[0], album.tracks)
    }
  }

  const allSongs = React.useMemo(() => {
    return library.flatMap(artist => artist.albums.flatMap(album => album.tracks.map(t => ({ ...t, artist: { name: artist.name }, album: { title: album.title } }))))
      .sort((a, b) => a.title.localeCompare(b.title))
  }, [library])

  const allAlbums = React.useMemo(() => {
    // Flatten albums but keep artist info if needed? 
    // Album object in library has title and tracks.
    return library.flatMap(artist => artist.albums)
  }, [library])

  const searchResults = React.useMemo(() => {
    if (!searchQuery) return null
    const lower = searchQuery.toLowerCase()
    // Filter songs
    const tracks = allSongs.filter(t =>
      t.title.toLowerCase().includes(lower) ||
      t.artist?.name?.toLowerCase().includes(lower) ||
      t.album?.title?.toLowerCase().includes(lower)
    )
    return { tracks }
  }, [searchQuery, allSongs, currentView, library])

  const handleScrollToLetter = (letter: string) => {
    // Optimization: if we have active letter logic, clicking should set it immediately
    // setActiveLetter(letter) // Will be set by scroll but instant feedback is good if we didn't rely on scroll for everything.
    // Actually, setting it manually might fight with the scroll listener if the scroll destination is slightly off. 
    // Let's rely on scroll listener or set it temporarily.
    // Better: let the scroll listener handle it to ensure truth.

    if (letter === '#') {
      const scrollContainer = document.querySelector('main.overflow-y-auto') || document.querySelector('.overflow-y-auto') || document.querySelector('main')
      if (scrollContainer) scrollContainer.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }

    const alphabet = "#ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("")
    const startIndex = alphabet.indexOf(letter)

    // Find first available letter starting from the clicked one
    let targetLetter = letter
    let foundElement: HTMLElement | null = null

    for (let i = startIndex; i < alphabet.length; i++) {
      const currentSearch = alphabet[i]

      if (currentView === 'songs') {
        // We need to find the ID. 
        // In render, we only put IDs on the first song of a letter.
        // So we can search for the element directly if we know the ID? No, we don't know the ID easily without lookup.
        // Check allSongs for first match
        const track = allSongs.find(t => t.title.toUpperCase().startsWith(currentSearch))
        if (track) {
          foundElement = document.getElementById(`song-${track.id}`)
          if (foundElement) {
            targetLetter = currentSearch
            break
          }
        }
      } else if (currentView === 'artists') {
        const artist = library.find(a => a.name.toUpperCase().startsWith(currentSearch))
        if (artist) {
          foundElement = document.getElementById(`artist-${artist.id}`)
          if (foundElement) {
            targetLetter = currentSearch
            break
          }
        }
      }
    }

    if (foundElement) {
      // Scroll to top with offset
      // We need to find the scrolling container again to calculate position
      const scrollContainer = document.querySelector('main.overflow-y-auto') || document.querySelector('.overflow-y-auto') || document.querySelector('main')
      if (scrollContainer) {
        // Calculate absolute top position in the scrollable area
        // element.offsetTop works if the element is relatively positioned within the scrolled parent.
        // But table rows might be tricky. Let's use getBoundingClientRect + current scrollTop.
        const rect = foundElement.getBoundingClientRect()
        // We need the container's rect too to be precise?
        // Actually: currentScroll + rect.top (relative to viewport) - containerOffset (relative to viewport)
        // Simpler: element.offsetTop is usually relative to the offsetParent (often the table or table body).
        // Let's stick to the standard calculation:
        // Desired ScrollTop = Current ScrollTop + Element Top Relative to Viewport - Desired Offset

        // Offset: We want it to be below the sticky header.
        // The sticky header stack is approx 60px (top bar) + 60px (section header) + padding etc.
        // Safe bet ~ 160-180px.
        // Refined: 
        // Songs: Top nav 60px. First item wants to be at 70px. Offset 70.
        // Artists: Top nav 60px + Sticky Header 50px. Item at 110px. Offset 110.
        const offset = currentView === 'artists' ? 110 : 70

        const currentScroll = scrollContainer.scrollTop
        const elementTop = rect.top // This is viewport relative
        // The container top is likely 0 or close to 0 in viewport usually, but let's be safe.
        const containerRect = scrollContainer.getBoundingClientRect()

        // Absolute position of element inside container's scrollable height:
        // absTop = currentScroll + (elementTop - containerRect.top)
        const absTop = currentScroll + (elementTop - containerRect.top)

        scrollContainer.scrollTo({
          top: absTop - offset,
          behavior: 'smooth'
        })
      }
    }
  }

  const renderContent = () => {
    // 1. Search Mode
    if (searchQuery && searchResults) {
      if (searchResults.tracks.length === 0) {
        return (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
            <p>No matches found for "{searchQuery}"</p>
          </div>
        )
      }
      return (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold tracking-tight">Top Results</h2>
          </div>
          <div className="rounded-md border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[50px]"></TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead className="hidden md:table-cell">Artist</TableHead>
                  <TableHead className="hidden md:table-cell">Album</TableHead>
                  <TableHead className="text-right pr-4"><Clock className="h-4 w-4 ml-auto" /></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {searchResults.tracks.map(track => (
                  <SongRow
                    key={track.id}
                    track={track}
                    isPlaying={currentTrack?.id === track.id && isPlaying}
                    onClick={() => playTrack(track, searchResults.tracks)}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )
    }

    // 2. Songs View
    if (currentView === 'songs') {
      // Find index of first song for each letter to add ID
      const firstIds = new Set<string>()
      let lastLetter = ''
      allSongs.forEach(song => {
        const currentLetter = song.title.charAt(0).toUpperCase()
        if (currentLetter !== lastLetter) {
          firstIds.add(song.id)
          lastLetter = currentLetter
        }
      })

      return (
        <div className="flex gap-4">
          <div className="flex-1 space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold tracking-tight">All Songs</h2>
              <span className="text-muted-foreground text-sm">{allSongs.length} songs</span>
            </div>
            <div className="rounded-md border bg-card">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-[50px]"></TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead className="hidden md:table-cell">Artist</TableHead>
                    <TableHead className="hidden md:table-cell">Album</TableHead>
                    <TableHead className="text-right pr-4"><Clock className="h-4 w-4 ml-auto" /></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {allSongs.map(track => {
                    const isFirst = firstIds.has(track.id)
                    const letter = track.title.charAt(0).toUpperCase()
                    return (
                      <SongRow
                        key={track.id}
                        id={isFirst ? `song-${track.id}` : undefined}
                        data-letter={isFirst ? letter : undefined}
                        track={track}
                        isPlaying={currentTrack?.id === track.id && isPlaying}
                        onClick={() => playTrack(track, allSongs)}
                      />
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
          <div
            className="fixed right-2 bottom-24 w-[20px] z-50 transition-[top] duration-100 ease-out"
            style={{ top: `${selectorTop}px` }}
          >
            <LetterSelector onLetterClick={handleScrollToLetter} activeLetter={activeLetter} />
          </div>
        </div>
      )
    }

    // 3. Albums View
    if (currentView === 'albums') {
      return (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold tracking-tight">Albums</h2>
            <span className="text-muted-foreground text-sm">{allAlbums.length} albums</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
            {allAlbums.map(album => (
              <AlbumCard key={album.id} album={album} playAlbum={playAlbum} />
            ))}
          </div>
        </div>
      )
    }

    // 4. Artists View
    if (currentView === 'artists') {
      // Ensure sorted alphabetically by name
      const sortedLibrary = [...library].sort((a, b) => a.name.localeCompare(b.name))

      return (
        <div className="flex gap-4">
          <div className="flex-1 space-y-8">
            {sortedLibrary.map(artist => {
              const letter = artist.name.charAt(0).toUpperCase()
              return (
                <div key={artist.id} id={`artist-${artist.id}`} data-letter={letter} className="space-y-4 -ml-8 px-8" style={{ contentVisibility: 'auto', containIntrinsicSize: '500px' }}>
                  <h2 className="text-xl font-semibold text-primary/80 sticky top-[60px] z-20 py-2 -mx-8 px-8 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
                    {artist.name}
                  </h2>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-6 pr-12">
                    {artist.albums.map(album => (
                      <AlbumCard key={album.id} album={album} playAlbum={playAlbum} />
                    ))}
                  </div>
                </div>
              )
            })}
            {library.length === 0 && !loading && (
              <div className="text-center py-20">
                <p className="text-muted-foreground">Your library is empty.</p>
              </div>
            )}
          </div>
          <div
            className="fixed right-2 bottom-24 w-[20px] z-50 transition-[top] duration-100 ease-out"
            style={{ top: `${selectorTop}px` }}
          >
            <LetterSelector onLetterClick={handleScrollToLetter} activeLetter={activeLetter} />
          </div>
        </div>
      )
    }

    return null
  }

  return (
    <div className="p-8 space-y-8 min-h-full">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight">Library</h1>
          <p className="text-muted-foreground capitalize">{currentView}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={triggerScan} disabled={scanning}>
            <RefreshCw className={`mr-2 h-4 w-4 ${scanning ? 'animate-spin' : ''}`} />
            {scanning ? 'Scanning...' : 'Scan Library'}
          </Button>
          <Button>
            <PlusCircle className="mr-2 h-4 w-4" />
            Add Folder
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64 text-muted-foreground">
          Loading library...
        </div>
      ) : renderContent()}
    </div>
  )
}
