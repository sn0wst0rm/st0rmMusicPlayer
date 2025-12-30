"use client"

import {
    Sidebar,
    SidebarContent,
    SidebarGroup,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarInput,
    useSidebar,
} from "@/components/ui/sidebar"
import {
    Command,
    CommandGroup,
    CommandItem,
    CommandList,
} from "@/components/ui/command"
import {
    Popover,
    PopoverContent,
    PopoverAnchor,
} from "@/components/ui/popover"
import * as React from "react"
import { ListMusic, Mic2, Search as SearchIcon, Music, Import, Disc, Plus } from "lucide-react"

import { Lightning } from "@/components/icons/lightning"
import { MarqueeText } from "@/components/ui/marquee-text"
import { usePlayerStore, Track } from "@/lib/store"
import { searchLibraryLimited, SongSearchResult, AlbumSearchResult, ArtistSearchResult } from "@/lib/search"
import { Album, Playlist } from "@/types/music"

export function AppSidebar() {
    const {
        searchQuery, setSearchQuery, currentView, setCurrentView, library, playTrack, setSelectedAlbum,
        playlists, setPlaylists, navigateToPlaylist, selectedPlaylistId
    } = usePlayerStore()
    const { setOpen, open } = useSidebar()
    const searchInputRef = React.useRef<React.ElementRef<typeof SidebarInput>>(null)
    const containerRef = React.useRef<HTMLDivElement>(null)
    const [openPopover, setOpenPopover] = React.useState(false)
    const [containerWidth, setContainerWidth] = React.useState(0)

    // Use advanced search with fuzzy matching and relevance scoring
    const searchResults = React.useMemo(() => {
        if (!searchQuery || searchQuery.length < 2) return { songs: [], albums: [], artists: [] }

        const results = searchLibraryLimited(searchQuery, library, {
            songs: 3,
            albums: 3,
            artists: 3
        })

        // Extract items from search results (they're wrapped with score metadata)
        return {
            songs: results.songs.map((r: SongSearchResult) => r.item),
            albums: results.albums.map((r: AlbumSearchResult) => r.item),
            artists: results.artists.map((r: ArtistSearchResult) => r.item)
        }
    }, [searchQuery, library])

    const hasResults = searchResults.songs.length > 0 || searchResults.albums.length > 0 || searchResults.artists.length > 0

    // Close popover when sidebar collapses or search is cleared
    React.useEffect(() => {
        if (!open) {
            setOpenPopover(false)
        }
    }, [open])

    // Fetch playlists on mount
    React.useEffect(() => {
        const fetchPlaylists = async () => {
            try {
                const response = await fetch('/api/playlists')
                if (response.ok) {
                    const data = await response.json()
                    setPlaylists(data)
                }
            } catch (error) {
                console.error('Failed to fetch playlists:', error)
            }
        }
        fetchPlaylists()
    }, [setPlaylists])

    const handlePlaySong = (track: Track) => {
        playTrack(track, [track]) // Play single track for now
        setOpenPopover(false)
    }

    const handleGoToArtist = () => {
        // We need a way to filter the Artist View or just switch to it?
        // The current implementation of ArtistView just lists all.
        // For now, switch to Artists view.
        setCurrentView('artists')
        // Ideally we would scroll to the artist.
        setOpenPopover(false)
    }

    const handleGoToAlbum = (album: Album & { artistName: string }) => {
        setSelectedAlbum({
            id: album.id,
            title: album.title,
            tracks: album.tracks,
            artistName: album.artistName
        })
        setOpenPopover(false)
    }

    const handleCreatePlaylist = async () => {
        try {
            const response = await fetch('/api/playlists', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: 'New Playlist' })
            })
            if (response.ok) {
                const newPlaylist: Playlist = await response.json()
                setPlaylists([newPlaylist, ...playlists])
                navigateToPlaylist(newPlaylist.id)
            }
        } catch (error) {
            console.error('Failed to create playlist:', error)
        }
    }


    return (
        <Sidebar collapsible="icon" className="border-r-0 bg-sidebar text-sidebar-foreground" variant="sidebar">
            <SidebarHeader className="p-4 group-data-[collapsible=icon]:px-2">
                <div className="flex items-center gap-0.5 px-2 overflow-hidden transition-all group-data-[collapsible=icon]:justify-center h-7">
                    <Lightning className="size-5 shrink-0 text-primary" />
                    <h2 className="text-xl font-semibold tracking-tight text-primary truncate group-data-[collapsible=icon]:hidden">Music</h2>
                </div>

                <SidebarMenu>
                    <SidebarMenuItem>
                        {/* Search - Full View */}
                        <div className="relative mt-2 group-data-[collapsible=icon]:hidden transition-all duration-200">
                            <Popover
                                open={openPopover && hasResults}
                                onOpenChange={(isOpen) => {
                                    // Only allow closing from outside clicks, not from input clicks
                                    if (!isOpen) {
                                        // Small delay to check if input still has focus
                                        setTimeout(() => {
                                            if (document.activeElement !== searchInputRef.current) {
                                                setOpenPopover(false)
                                            }
                                        }, 0)
                                    }
                                }}
                            >
                                <PopoverAnchor asChild>
                                    <div className="relative w-full" ref={containerRef}>
                                        <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                                        <SidebarInput
                                            ref={searchInputRef}
                                            placeholder="Search"
                                            className="pl-9 bg-neutral-200/50 dark:bg-secondary/50 border-none w-full focus-visible:ring-2 focus-visible:ring-primary"
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                    setCurrentView('search')
                                                    setOpenPopover(false)
                                                }
                                            }}
                                            onFocus={() => {
                                                // Delay to allow sidebar expand animation to complete
                                                setTimeout(() => {
                                                    if (containerRef.current) {
                                                        setContainerWidth(containerRef.current.offsetWidth)
                                                    }
                                                    setOpenPopover(true)
                                                }, 200)
                                            }}
                                            onBlur={(e) => {
                                                // Close popover when clicking outside, but not when clicking on popover content
                                                const relatedTarget = e.relatedTarget as HTMLElement | null
                                                if (!relatedTarget?.closest('[data-radix-popper-content-wrapper]')) {
                                                    setOpenPopover(false)
                                                }
                                            }}
                                        />
                                    </div>
                                </PopoverAnchor>
                                <PopoverContent
                                    className="p-0 overflow-hidden"
                                    style={{ width: containerWidth > 0 ? `${containerWidth + 8}px` : 'auto' }}
                                    align="start"
                                    alignOffset={-4}
                                    sideOffset={6}
                                    onOpenAutoFocus={(e) => e.preventDefault()}
                                >
                                    <Command className="w-full overflow-hidden">
                                        <CommandList className="max-h-80 overflow-y-auto overflow-x-hidden scrollbar-hide">
                                            {searchResults.songs.length > 0 && (
                                                <CommandGroup heading="Songs">
                                                    {searchResults.songs.map((song) => (
                                                        <CommandItem key={song.id} onSelect={() => handlePlaySong(song)} className="gap-3 overflow-hidden">
                                                            <Music className="h-4 w-4 shrink-0 text-muted-foreground" />
                                                            <div className="flex flex-col min-w-0 flex-1">
                                                                <MarqueeText text={song.title} className="text-sm" />
                                                                <span className="text-xs text-muted-foreground truncate">{song.artist?.name}</span>
                                                            </div>
                                                        </CommandItem>
                                                    ))}
                                                </CommandGroup>
                                            )}
                                            {searchResults.albums.length > 0 && (
                                                <CommandGroup heading="Albums">
                                                    {searchResults.albums.map((album) => (
                                                        <CommandItem key={album.id} onSelect={() => handleGoToAlbum(album)} className="gap-3 overflow-hidden">
                                                            <Disc className="h-4 w-4 shrink-0 text-muted-foreground" />
                                                            <div className="flex flex-col min-w-0 flex-1">
                                                                <MarqueeText text={album.title} className="text-sm" />
                                                                <span className="text-xs text-muted-foreground truncate">{album.artistName || "Unknown Artist"}</span>
                                                            </div>
                                                        </CommandItem>
                                                    ))}
                                                </CommandGroup>
                                            )}
                                            {searchResults.artists.length > 0 && (
                                                <CommandGroup heading="Artists">
                                                    {searchResults.artists.map((artist) => (
                                                        <CommandItem key={artist.id} onSelect={() => handleGoToArtist()} className="gap-3 overflow-hidden">
                                                            <Mic2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                                                            <div className="flex flex-col min-w-0 flex-1">
                                                                <MarqueeText text={artist.name} className="text-sm" />
                                                                <span className="text-xs text-muted-foreground truncate">Artist</span>
                                                            </div>
                                                        </CommandItem>
                                                    ))}
                                                </CommandGroup>
                                            )}
                                        </CommandList>
                                    </Command>
                                </PopoverContent>
                            </Popover>
                        </div>

                        {/* Search - Icon View */}
                        <div className="hidden mt-2 group-data-[collapsible=icon]:flex justify-center items-center w-full">
                            <SidebarMenuButton
                                className="justify-center size-8 p-0"
                                onClick={() => {
                                    setOpen(true)
                                    setTimeout(() => searchInputRef.current?.focus(), 100)
                                }}
                            >
                                <SearchIcon className="size-4" />
                                <span className="sr-only">Search</span>
                            </SidebarMenuButton>
                        </div>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarHeader>
            <SidebarContent>
                <SidebarGroup>
                    <SidebarGroupLabel>Apple Music</SidebarGroupLabel>
                    <SidebarGroupContent>
                        <SidebarMenu>
                            <SidebarMenuItem>
                                <SidebarMenuButton
                                    isActive={currentView === 'import'}
                                    onClick={() => setCurrentView('import')}
                                >
                                    <Import />
                                    <span>Import</span>
                                </SidebarMenuButton>
                            </SidebarMenuItem>
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>

                <SidebarGroup>
                    <SidebarGroupLabel>Library</SidebarGroupLabel>
                    <SidebarGroupContent>
                        <SidebarMenu>

                            <SidebarMenuItem>
                                <SidebarMenuButton isActive={currentView === 'artists'} onClick={() => setCurrentView('artists')}>
                                    <Mic2 />
                                    <span>Artists</span>
                                </SidebarMenuButton>
                            </SidebarMenuItem>
                            <SidebarMenuItem>
                                <SidebarMenuButton isActive={currentView === 'albums'} onClick={() => setCurrentView('albums')}>
                                    <ListMusic />
                                    <span>Albums</span>
                                </SidebarMenuButton>
                            </SidebarMenuItem>
                            <SidebarMenuItem>
                                <SidebarMenuButton isActive={currentView === 'songs'} onClick={() => setCurrentView('songs')}>
                                    <Music />
                                    <span>Songs</span>
                                </SidebarMenuButton>
                            </SidebarMenuItem>
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>

                <SidebarGroup>
                    <div className="flex items-center justify-between pr-2">
                        <SidebarGroupLabel>Playlists</SidebarGroupLabel>
                        <button
                            onClick={handleCreatePlaylist}
                            className="p-1 rounded-md hover:bg-accent transition-colors group-data-[collapsible=icon]:hidden"
                            title="Create Playlist"
                        >
                            <Plus className="size-4 text-muted-foreground hover:text-foreground" />
                        </button>
                    </div>
                    <SidebarGroupContent>
                        <SidebarMenu>
                            {playlists.length === 0 ? (
                                <SidebarMenuItem>
                                    <span className="px-2 py-1.5 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
                                        No playlists yet
                                    </span>
                                </SidebarMenuItem>
                            ) : (
                                playlists.map((playlist) => (
                                    <SidebarMenuItem key={playlist.id}>
                                        <SidebarMenuButton
                                            isActive={currentView === 'playlist' && selectedPlaylistId === playlist.id}
                                            onClick={() => navigateToPlaylist(playlist.id)}
                                        >
                                            {playlist.coverPath || playlist.artworkUrl ? (
                                                <div className="relative size-4 rounded overflow-hidden flex-shrink-0">
                                                    <img
                                                        src={playlist.coverPath
                                                            ? `/api/playlist-cover/${encodeURIComponent(playlist.coverPath)}`
                                                            : playlist.artworkUrl!
                                                        }
                                                        alt=""
                                                        className="w-full h-full object-cover"
                                                        onError={(e) => {
                                                            // Fall back to icon on error
                                                            e.currentTarget.parentElement!.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15V6"/><path d="M18.5 18a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"/><path d="M12 12H3"/><path d="M16 6H3"/><path d="M12 18H3"/></svg>'
                                                        }}
                                                    />
                                                </div>
                                            ) : (
                                                <ListMusic className="size-4" />
                                            )}
                                            <span className="truncate">{playlist.name}</span>
                                        </SidebarMenuButton>
                                    </SidebarMenuItem>
                                ))
                            )}
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>
            </SidebarContent>
        </Sidebar>
    )
}
