"use client"

import {
    Sidebar,
    SidebarContent,
    SidebarGroup,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarFooter,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarProvider,
    SidebarTrigger,
    SidebarInput,
    useSidebar,
} from "@/components/ui/sidebar"
import * as React from "react"
import { ListMusic, Mic2, Search as SearchIcon, Music, Import } from "lucide-react"

import { Lightning } from "@/components/icons/lightning"
import { usePlayerStore } from "@/lib/store"

export function AppSidebar() {
    const { searchQuery, setSearchQuery, currentView, setCurrentView } = usePlayerStore()
    const { setOpen } = useSidebar()
    const searchInputRef = React.useRef<React.ElementRef<typeof SidebarInput>>(null)

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
                            <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                            <SidebarInput
                                ref={searchInputRef}
                                placeholder="Search"
                                className="pl-9 bg-neutral-200/50 dark:bg-secondary/50 border-none w-full"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
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
