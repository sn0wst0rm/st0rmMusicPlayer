"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { usePlayerStore, Track } from "@/lib/store"
import { PlayCircle, PlusCircle, RefreshCw, Play, Clock } from "lucide-react"
import { Virtuoso, TableVirtuoso, TableVirtuosoHandle, VirtuosoHandle, VirtuosoGrid } from 'react-virtuoso'
import { LetterSelector } from "@/components/ui/letter-selector"
import { cn } from "@/lib/utils"

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
  const [activeLetter, setActiveLetter] = React.useState('#')
  const { playTrack, searchQuery, currentView, currentTrack, isPlaying } = usePlayerStore()

  // Refs for virtualization
  const tableVirtuosoRef = React.useRef<TableVirtuosoHandle>(null)
  const virtuosoRef = React.useRef<VirtuosoHandle>(null)

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
    }
  }



  const letterSelectorRef = React.useRef<HTMLDivElement>(null)

  // Throttled scroll handler for active letter detection + bar resizing
  const handleScroll = (e: React.UIEvent<HTMLElement>) => {
    // 1. Resize Letter Selector
    if (letterSelectorRef.current) {
      const scrollTop = e.currentTarget.scrollTop
      const top = Math.max(100, 150 - scrollTop)
      letterSelectorRef.current.style.top = `${top}px`
    }

    // 2. Detect Active Letter (Artists only)
    if (currentView === 'artists') {
      // Probe point: Center X, 80px Y (safely inside the 56px+Header zone)
      const x = window.innerWidth / 2
      const y = 80
      const el = document.elementFromPoint(x, y)
      // Traverse up to find the header with data attribute
      const header = el?.closest('[data-artist-letter]') as HTMLElement
      if (header) {
        const letter = header.getAttribute('data-artist-letter')
        if (letter && letter !== activeLetter) {
          setActiveLetter(letter)
        }
      }
    }
  }

  // Effect to reset top position when view changes
  React.useEffect(() => {
    if (letterSelectorRef.current) {
      letterSelectorRef.current.style.top = '150px'
    }
  }, [currentView])

  React.useEffect(() => {
    fetchLibrary()
  }, [fetchLibrary])

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

  // --- Data Preparation ---

  const allSongs = React.useMemo(() => {
    return library.flatMap(artist => artist.albums.flatMap(album => album.tracks.map(t => ({ ...t, artist: { name: artist.name }, album: { title: album.title } }))))
      .sort((a, b) => a.title.localeCompare(b.title))
  }, [library])

  const allAlbums = React.useMemo(() => {
    return library.flatMap(artist => artist.albums)
  }, [library])

  const sortedArtists = React.useMemo(() => {
    return [...library].sort((a, b) => a.name.localeCompare(b.name))
  }, [library])

  // --- Letter Logic ---

  // Generate Letter -> Index maps for efficient scrolling
  const songsLetterMap = React.useMemo(() => {
    const map = new Map<string, number>()
    let lastLetter = ''
    allSongs.forEach((song, index) => {
      const char = song.title.charAt(0).toUpperCase()
      if (char !== lastLetter) {
        if (!map.has(char)) map.set(char, index)
        lastLetter = char
      }
    })
    return map
  }, [allSongs])

  const artistsLetterMap = React.useMemo(() => {
    const map = new Map<string, number>()
    sortedArtists.forEach((artist, index) => {
      const char = artist.name.charAt(0).toUpperCase()
      if (!map.has(char)) map.set(char, index)
    })
    return map
  }, [sortedArtists])


  // --- Render Helpers ---

  const searchResults = React.useMemo(() => {
    if (!searchQuery) return null
    const lower = searchQuery.toLowerCase()
    const tracks = allSongs.filter(t =>
      t.title.toLowerCase().includes(lower) ||
      t.artist?.name?.toLowerCase().includes(lower) ||
      t.album?.title?.toLowerCase().includes(lower)
    )
    return { tracks }
  }, [searchQuery, allSongs])

  // --- Main Render ---

  // --- Components ---

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
      <caption className="caption-top p-0 m-0 w-full block">
        <HeaderContent />
      </caption>
    )
  }, [HeaderContent])

  const renderVirtualFooter = React.useCallback(() => <div className="h-32" />, [])

  // Memoize components objects for Virtuoso to prevent remounts
  // We use context to pass dynamic data/callbacks to avoid recreating components
  const tableComponents = React.useMemo(() => ({
    Table: (props: any) => <table {...props} className="w-full caption-bottom text-sm border-collapse mb-32" />,
    TableRow: ({ item, context, ...props }: any) => (
      <tr
        {...props}
        className="border-b transition-colors hover:bg-muted/50 cursor-pointer group hover:bg-muted/50"
        onClick={() => context.playTrack(item, context.allSongs)}
      />
    ),
  }), [])

  const searchTableComponents = React.useMemo(() => ({
    Table: (props: any) => <table {...props} className="w-full caption-bottom text-sm border-collapse mb-32" />,
    TableRow: ({ item, context, ...props }: any) => (
      <tr
        {...props}
        className="border-b transition-colors hover:bg-muted/50 cursor-pointer"
        onClick={() => context.playTrack(item, context.tracks)}
      />
    ),
  }), [])

  const artistsComponents = React.useMemo(() => ({
    Header: HeaderContent,
    Footer: renderVirtualFooter
  }), [HeaderContent, renderVirtualFooter])

  const albumsComponents = React.useMemo(() => ({
    Header: HeaderContent,
    Item: (props: any) => <div {...props} className="p-1" />,
    List: React.forwardRef((props, ref) => <div {...props} ref={ref as any} className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6 px-8" />),
    Footer: renderVirtualFooter
  }), [HeaderContent, renderVirtualFooter])


  if (loading) {
    return (
      <div className="flex flex-col h-full w-full pt-14">
        <HeaderContent />
        <div className="flex items-center justify-center flex-1 text-muted-foreground">
          Loading library...
        </div>
      </div>
    )
  }

  // 1. Search Mode
  if (searchQuery && searchResults) {
    return (
      <div className="flex flex-col h-full w-full">
        <div className="flex-1 pt-14 overflow-x-hidden">
          <div className="flex items-center justify-between py-6 pb-2 px-8">
            <h2 className="text-2xl font-bold tracking-tight">Top Results</h2>
          </div>
          <TableVirtuoso
            style={{ height: '100%', overscrollBehavior: 'none' }}
            data={searchResults.tracks}
            context={{ playTrack, tracks: searchResults.tracks }}
            fixedHeaderContent={() => (
              <tr className="bg-background border-b z-20">
                <th className="h-12 text-left align-middle font-medium text-muted-foreground w-[50px] bg-background pl-8 pr-4"></th>
                <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground bg-background">Title</th>
                <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground hidden md:table-cell bg-background">Artist</th>
                <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground hidden md:table-cell bg-background">Album</th>
                <th className="h-12 align-middle font-medium text-muted-foreground text-right pr-8 bg-background"><Clock className="h-4 w-4 ml-auto" /></th>
              </tr>
            )}
            itemContent={(index, track) => (
              <>
                <td className="p-4 align-middle bg-background/50 w-[50px] pl-8 py-2">
                  <div className="relative w-10 h-10 flex items-center justify-center rounded-md overflow-hidden bg-secondary group/image">
                    <img
                      src={`/api/cover/${track.id}?size=small`}
                      alt={track.title}
                      className="w-full h-full object-cover"
                      onError={(e) => { e.currentTarget.style.display = 'none' }}
                    />
                    {isPlaying && currentTrack?.id === track.id && (
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                        <Play className="h-5 w-5 fill-primary text-primary" />
                      </div>
                    )}
                  </div>
                </td>
                <td className="p-4 align-middle font-medium py-2">
                  <div className="flex flex-col">
                    <span className="line-clamp-1 text-sm">{track.title}</span>
                    <span className="text-xs text-muted-foreground md:hidden line-clamp-1">{track.artist?.name}</span>
                  </div>
                </td>
                <td className="p-4 align-middle hidden md:table-cell text-muted-foreground text-sm line-clamp-1 max-w-[200px] py-2">{track.artist?.name}</td>
                <td className="p-4 align-middle hidden md:table-cell text-muted-foreground text-sm line-clamp-1 max-w-[200px] py-2">{track.album?.title}</td>
                <td className="p-4 align-middle text-right text-muted-foreground text-sm font-variant-numeric tabular-nums pr-8 py-2">
                  {formatDuration(track.duration)}
                </td>
              </>
            )}
            components={searchTableComponents}
          />
        </div>
      </div>
    )
  }

  // 2. Songs View
  if (currentView === 'songs') {
    return (
      <div className="flex flex-col h-full w-full">
        <div className="flex flex-1 min-h-0 relative overflow-x-hidden">
          <div className="flex-1 min-w-0 h-full">
            <TableVirtuoso
              ref={tableVirtuosoRef}
              style={{ height: '100%', overscrollBehavior: 'none' }}
              data={allSongs}
              context={{ playTrack, allSongs }}
              rangeChanged={({ startIndex }) => {
                const song = allSongs[startIndex]
                if (song) setActiveLetter(song.title.charAt(0).toUpperCase())
              }}
              fixedHeaderContent={() => (
                <tr className="bg-background border-b z-20">
                  <th className="h-12 text-left align-middle font-medium text-muted-foreground w-[50px] bg-background pl-8 pr-4"></th>
                  <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground bg-background">Title</th>
                  <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground hidden md:table-cell bg-background">Artist</th>
                  <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground hidden md:table-cell bg-background">Album</th>
                  <th className="h-12 align-middle font-medium text-muted-foreground text-right pr-8 bg-background"><Clock className="h-4 w-4 ml-auto" /></th>
                </tr>
              )}
              itemContent={(index, track) => (
                <>
                  <td className="p-4 align-middle w-[50px] pl-8 py-2">
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
                      {isPlaying && currentTrack?.id === track.id && (
                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                          <Play className="h-5 w-5 fill-primary text-primary" />
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="p-4 align-middle font-medium py-2">
                    <div className="flex flex-col">
                      <span className="line-clamp-1 text-sm">{track.title}</span>
                      <span className="text-xs text-muted-foreground md:hidden line-clamp-1">{track.artist?.name}</span>
                    </div>
                  </td>
                  <td className="p-4 align-middle hidden md:table-cell text-muted-foreground text-sm line-clamp-1 max-w-[200px] py-2">{track.artist?.name}</td>
                  <td className="p-4 align-middle hidden md:table-cell text-muted-foreground text-sm line-clamp-1 max-w-[200px] py-2">{track.album?.title}</td>
                  <td className="p-4 align-middle text-right text-muted-foreground text-sm font-variant-numeric tabular-nums pr-8 py-2">
                    {formatDuration(track.duration)}
                  </td>
                </>
              )}
              components={{
                ...tableComponents,
                // Wrap HeaderContent for Table
                Table: (props: any) => (
                  <table {...props} className="w-full caption-bottom text-sm border-collapse mb-32">
                    <TableHeaderContent />
                    {props.children}
                  </table>
                )
              }}
              onScroll={handleScroll}
            />
          </div>
        </div>
        <div
          ref={letterSelectorRef}
          className="absolute right-2 z-50 pointer-events-none"
          style={{ top: '150px', bottom: '90px' }}
        >
          <div className="pointer-events-auto h-full">
            <LetterSelector onLetterClick={handleLetterClick} activeLetter={activeLetter} />
          </div>
        </div>
      </div>
    )
  }

  // 3. Artists View
  if (currentView === 'artists') {
    return (
      <div className="flex flex-col h-full w-full">
        <div className="flex flex-1 min-h-0 relative overflow-x-hidden">
          <div className="flex-1 min-w-0 h-full">
            <Virtuoso
              ref={virtuosoRef}
              style={{ height: '100%', overscrollBehavior: 'none' }}
              data={sortedArtists}
              rangeChanged={({ startIndex }) => {
                // Determine active letter via scroll inspection now
              }}
              itemContent={(index, artist) => (
                <div className="mb-8">
                  <h2
                    className="text-xl font-semibold text-primary/80 sticky top-[56px] z-30 py-2 px-8 bg-background/60 backdrop-blur-md"
                    data-artist-letter={artist.name.charAt(0).toUpperCase()}
                  >
                    {artist.name}
                  </h2>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-6 mt-4 px-8">
                    {artist.albums.map(album => (
                      <AlbumCard key={album.id} album={album} playAlbum={playAlbum} />
                    ))}
                  </div>
                </div>
              )}
              components={artistsComponents}
              onScroll={handleScroll}
            />
          </div>
        </div>
        <div
          ref={letterSelectorRef}
          className="absolute right-3 z-50 pointer-events-none"
          style={{ top: '150px', bottom: '90px' }}
        >
          <div className="pointer-events-auto h-full">
            <LetterSelector onLetterClick={handleLetterClick} activeLetter={activeLetter} />
          </div>
        </div>
      </div>
    )
  }

  // 4. Albums View
  if (currentView === 'albums') {
    return (
      <div className="flex flex-col h-full w-full">
        <div className="flex-1 min-h-0 overflow-x-hidden">
          <VirtuosoGrid
            style={{ height: '100%', overscrollBehavior: 'none' }}
            data={allAlbums}
            components={albumsComponents}
            itemContent={(index, album) => (
              <AlbumCard key={album.id} album={album} playAlbum={playAlbum} />
            )}
          />
        </div>
      </div>
    )
  }

}
