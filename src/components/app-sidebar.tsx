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
import { ListMusic, Mic2, Search as SearchIcon, Music, Import, Disc } from "lucide-react"

import { Lightning } from "@/components/icons/lightning"
import { MarqueeText } from "@/components/ui/marquee-text"
import { usePlayerStore, Track } from "@/lib/store"
import { searchLibraryLimited, SongSearchResult, AlbumSearchResult, ArtistSearchResult } from "@/lib/search"
import { Album } from "@/types/music"

export function AppSidebar() {
    const { searchQuery, setSearchQuery, currentView, setCurrentView, library, playTrack, setSelectedAlbum } = usePlayerStore()
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


    return (
        <Sidebar collapsible="icon" className="border-r-0 bg-sidebar text-sidebar-foreground" variant="sidebar">
            <SidebarHeader className="p-4 group-data-[collapsible=icon]:px-2">
                <div className="flex items-center gap-2 px-2 overflow-hidden transition-all group-data-[collapsible=icon]:justify-center h-7">
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
                                <SidebarMenuButton>
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
            </SidebarContent>
        </Sidebar>
    )
}
