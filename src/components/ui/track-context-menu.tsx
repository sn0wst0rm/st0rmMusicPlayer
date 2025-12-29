"use client"

import * as React from "react"
import { ListPlus, Plus, Mic2, Disc, ListMusic, PlusCircle, AlertTriangle } from "lucide-react"
import { toast } from "sonner"
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuSub,
    ContextMenuSubContent,
    ContextMenuSubTrigger,
    ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import {
    AlertDialog,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Track, usePlayerStore } from "@/lib/store"
import { Playlist } from "@/types/music"

interface TrackContextMenuProps {
    track: Track
    children: React.ReactNode
    onGoToArtist?: () => void
    onGoToAlbum?: () => void
}

export function TrackContextMenu({
    track,
    children,
    onGoToArtist,
    onGoToAlbum,
}: TrackContextMenuProps) {
    const { playNext, addToQueue, playlists, setPlaylists, navigateToArtist } = usePlayerStore()
    const [isCreateDialogOpen, setIsCreateDialogOpen] = React.useState(false)
    const [newPlaylistName, setNewPlaylistName] = React.useState("")
    const [isCreating, setIsCreating] = React.useState(false)

    // State for duplicate warning dialog
    const [isDuplicateDialogOpen, setIsDuplicateDialogOpen] = React.useState(false)
    const [pendingPlaylistId, setPendingPlaylistId] = React.useState<string | null>(null)
    const [pendingPlaylistName, setPendingPlaylistName] = React.useState("")

    const handlePlayNext = () => {
        playNext(track)
        toast.success("Playing Next", {
            description: track.title
        })
    }

    const handleAddToQueue = () => {
        addToQueue(track)
        toast.success("Added to Queue", {
            description: track.title
        })
    }

    const handleGoToArtist = () => {
        if (onGoToArtist) {
            onGoToArtist()
        } else if (track.artist?.name) {
            navigateToArtist(track.artist.name)
        }
    }

    const handleGoToAlbum = () => {
        if (onGoToAlbum) {
            onGoToAlbum()
        }
    }

    // Check if track exists in playlist before adding
    const checkAndAddToPlaylist = async (playlistId: string, playlistName: string) => {
        try {
            // Fetch playlist details to check if track already exists
            const response = await fetch(`/api/playlists/${playlistId}`)
            if (!response.ok) {
                // If we can't fetch, just proceed with adding
                await addTrackToPlaylist(playlistId, playlistName)
                return
            }

            const playlistDetail = await response.json()
            const trackExists = playlistDetail.tracks?.some(
                (pt: { track: { id: string } }) => pt.track.id === track.id
            )

            if (trackExists) {
                // Track already exists - show warning dialog
                setPendingPlaylistId(playlistId)
                setPendingPlaylistName(playlistName)
                setIsDuplicateDialogOpen(true)
            } else {
                // Track doesn't exist - add directly
                await addTrackToPlaylist(playlistId, playlistName)
            }
        } catch (error) {
            console.error('Error checking playlist:', error)
            // On error, just try to add the track
            await addTrackToPlaylist(playlistId, playlistName)
        }
    }

    const addTrackToPlaylist = async (playlistId: string, playlistName: string) => {
        try {
            const response = await fetch(`/api/playlists/${playlistId}/tracks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ trackIds: [track.id], force: true })
            })

            const result = await response.json()

            if (response.ok && result.added > 0) {
                // Get the playlist track ID that was just created for proper undo
                const playlistTrackId = result.playlistTrackIds?.[0]

                // Show success toast with undo action
                toast.success(`Added to "${playlistName}"`, {
                    description: track.title,
                    action: playlistTrackId ? {
                        label: "Undo",
                        onClick: async () => {
                            await removePlaylistTrack(playlistId, playlistTrackId, playlistName)
                        }
                    } : undefined
                })
            } else {
                toast.error("Failed to add track", {
                    description: result.error || "Please try again"
                })
            }
        } catch (error) {
            console.error('Error adding track to playlist:', error)
            toast.error("Failed to add track", {
                description: "An error occurred"
            })
        }
    }

    const removePlaylistTrack = async (playlistId: string, playlistTrackId: string, playlistName: string) => {
        try {
            const deleteResponse = await fetch(
                `/api/playlists/${playlistId}/tracks?playlistTrackId=${playlistTrackId}`,
                { method: 'DELETE' }
            )
            if (deleteResponse.ok) {
                toast.success(`Removed from "${playlistName}"`, {
                    description: track.title
                })
            } else {
                toast.error("Failed to undo", {
                    description: "Could not remove track"
                })
            }
        } catch (error) {
            console.error('Error removing track from playlist:', error)
            toast.error("Failed to undo", {
                description: "An error occurred"
            })
        }
    }

    const handleConfirmDuplicateAdd = async () => {
        if (pendingPlaylistId && pendingPlaylistName) {
            await addTrackToPlaylist(pendingPlaylistId, pendingPlaylistName)
        }
        setIsDuplicateDialogOpen(false)
        setPendingPlaylistId(null)
        setPendingPlaylistName("")
    }

    const handleCancelDuplicateAdd = () => {
        setIsDuplicateDialogOpen(false)
        setPendingPlaylistId(null)
        setPendingPlaylistName("")
    }

    const handleCreateNewPlaylist = async () => {
        if (!newPlaylistName.trim()) return

        setIsCreating(true)
        try {
            // Create the playlist
            const createResponse = await fetch('/api/playlists', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newPlaylistName.trim() })
            })

            if (!createResponse.ok) {
                throw new Error('Failed to create playlist')
            }

            const newPlaylist: Playlist = await createResponse.json()

            // Add track to the new playlist
            const addResponse = await fetch(`/api/playlists/${newPlaylist.id}/tracks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ trackIds: [track.id] })
            })

            if (addResponse.ok) {
                toast.success(`Created "${newPlaylist.name}"`, {
                    description: `Added "${track.title}"`
                })
            } else {
                toast.warning(`Created "${newPlaylist.name}"`, {
                    description: "But failed to add the track"
                })
            }

            // Update playlists in store
            setPlaylists([newPlaylist, ...playlists])

            // Reset and close dialog
            setNewPlaylistName("")
            setIsCreateDialogOpen(false)
        } catch (error) {
            console.error('Error creating playlist:', error)
            toast.error("Failed to create playlist")
        } finally {
            setIsCreating(false)
        }
    }

    return (
        <>
            <ContextMenu>
                <ContextMenuTrigger asChild>
                    {children}
                </ContextMenuTrigger>
                <ContextMenuContent className="w-56">
                    <ContextMenuItem onClick={handlePlayNext}>
                        <ListPlus className="mr-2 h-4 w-4" />
                        Play Next
                    </ContextMenuItem>
                    <ContextMenuItem onClick={handleAddToQueue}>
                        <Plus className="mr-2 h-4 w-4" />
                        Add to Queue
                    </ContextMenuItem>

                    <ContextMenuSeparator />

                    {track.artist?.name && (
                        <ContextMenuItem onClick={handleGoToArtist}>
                            <Mic2 className="mr-2 h-4 w-4" />
                            Go to Artist
                        </ContextMenuItem>
                    )}
                    {onGoToAlbum && (
                        <ContextMenuItem onClick={handleGoToAlbum}>
                            <Disc className="mr-2 h-4 w-4" />
                            Go to Album
                        </ContextMenuItem>
                    )}

                    {(track.artist?.name || onGoToAlbum) && <ContextMenuSeparator />}

                    <ContextMenuSub>
                        <ContextMenuSubTrigger>
                            <ListMusic className="mr-2 h-4 w-4" />
                            Add to Playlist
                        </ContextMenuSubTrigger>
                        <ContextMenuSubContent className="w-52">
                            <ContextMenuItem onClick={() => setIsCreateDialogOpen(true)}>
                                <PlusCircle className="mr-2 h-4 w-4" />
                                Add to New Playlist...
                            </ContextMenuItem>

                            {playlists.length > 0 && <ContextMenuSeparator />}

                            {playlists.map((playlist) => (
                                <PlaylistMenuItem
                                    key={playlist.id}
                                    playlist={playlist}
                                    onSelect={() => checkAndAddToPlaylist(playlist.id, playlist.name)}
                                />
                            ))}
                        </ContextMenuSubContent>
                    </ContextMenuSub>
                </ContextMenuContent>
            </ContextMenu>

            {/* Create New Playlist Dialog */}
            <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
                <DialogContent className="sm:max-w-[425px]">
                    <DialogHeader>
                        <DialogTitle>Create New Playlist</DialogTitle>
                        <DialogDescription>
                            Enter a name for your new playlist. The track will be added automatically.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                            <Label htmlFor="playlist-name">Playlist name</Label>
                            <Input
                                id="playlist-name"
                                value={newPlaylistName}
                                onChange={(e) => setNewPlaylistName(e.target.value)}
                                placeholder="My Playlist"
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && newPlaylistName.trim()) {
                                        handleCreateNewPlaylist()
                                    }
                                }}
                                autoFocus
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => {
                                setNewPlaylistName("")
                                setIsCreateDialogOpen(false)
                            }}
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={handleCreateNewPlaylist}
                            disabled={!newPlaylistName.trim() || isCreating}
                        >
                            {isCreating ? "Creating..." : "Create"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Duplicate Track Warning Dialog */}
            <AlertDialog open={isDuplicateDialogOpen} onOpenChange={setIsDuplicateDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle className="flex items-center gap-2">
                            <AlertTriangle className="h-5 w-5 text-amber-500" />
                            Song Already in Playlist
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            <strong>&quot;{track.title}&quot;</strong> is already in <strong>&quot;{pendingPlaylistName}&quot;</strong>.
                            Do you want to add it again?
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <Button variant="outline" onClick={handleCancelDuplicateAdd}>
                            Cancel
                        </Button>
                        <Button onClick={handleConfirmDuplicateAdd}>
                            Add Anyway
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    )
}

// Separate component for playlist menu items with tooltip for synced playlists
function PlaylistMenuItem({
    playlist,
    onSelect,
}: {
    playlist: Playlist
    onSelect: () => void
}) {
    if (playlist.isSynced) {
        return (
            <TooltipProvider delayDuration={300}>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <div>
                            <ContextMenuItem disabled className="opacity-50">
                                <ListMusic className="mr-2 h-4 w-4" />
                                {playlist.name}
                            </ContextMenuItem>
                        </div>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-[200px]">
                        <p>This playlist is synced from Apple Music and cannot be modified</p>
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>
        )
    }

    return (
        <ContextMenuItem onClick={onSelect}>
            <ListMusic className="mr-2 h-4 w-4" />
            {playlist.name}
        </ContextMenuItem>
    )
}
