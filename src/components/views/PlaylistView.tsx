"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { AudioWaveform } from "@/components/ui/audio-waveform"
import { TrackContextMenu } from "@/components/ui/track-context-menu"
import { Textarea } from "@/components/ui/textarea"
import {
    AlertDialog,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Play, Shuffle, ChevronLeft, Pause, ListPlus, Plus, Trash2, Pencil, Check, X, CloudCog, GripVertical, ImagePlus, ImageOff } from "lucide-react"
import { cn } from "@/lib/utils"
import { usePlayerStore, Track } from "@/lib/store"
import { PlaylistDetail, PlaylistTrackItem } from "@/types/music"
import { PlaylistCover } from "@/components/ui/playlist-cover"
import { toast } from "sonner"
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent,
} from "@dnd-kit/core"
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    useSortable,
    verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"

interface PlaylistViewProps {
    playlistId: string
    onBack: () => void
}

function formatDuration(seconds: number) {
    if (!seconds) return "0:00"
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
}

function formatTotalDuration(tracks: PlaylistTrackItem[]) {
    const totalSeconds = tracks.reduce((acc, pt) => acc + (pt.track.duration || 0), 0)
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    if (hours > 0) {
        return `${hours} hr ${minutes} min`
    }
    return `${minutes} min`
}

// Sortable track row component
interface SortableTrackRowProps {
    playlistTrack: PlaylistTrackItem
    index: number
    playlist: PlaylistDetail
    isCurrentTrack: (id: string) => boolean
    isCurrentTrackPlaying: (id: string) => boolean
    handlePlayTrack: (track: Track, index: number) => void
    setIsPlaying: (playing: boolean) => void
    playNext: (track: Track) => void
    addToQueue: (track: Track) => void
    handleRemoveTrack: (id: string, track: Track) => void
    navigateToArtist: (name: string) => void
    handleGoToAlbum: () => void
    isDraggingEnabled: boolean
}

function SortableTrackRow({
    playlistTrack,
    index,
    playlist,
    isCurrentTrack,
    isCurrentTrackPlaying,
    handlePlayTrack,
    setIsPlaying,
    playNext,
    addToQueue,
    handleRemoveTrack,
    navigateToArtist,
    handleGoToAlbum,
    isDraggingEnabled,
}: SortableTrackRowProps) {
    const track = playlistTrack.track
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: playlistTrack.id, disabled: !isDraggingEnabled })

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
    }

    return (
        <TrackContextMenu
            track={track}
            onGoToArtist={track.artist?.name ? () => navigateToArtist(track.artist!.name) : undefined}
            onGoToAlbum={track.albumId ? handleGoToAlbum : undefined}
        >
            <div
                ref={setNodeRef}
                style={style}
                className={cn(
                    "flex items-center gap-4 px-4 py-3 hover:bg-muted/50 cursor-pointer transition-colors group",
                    index !== playlist.tracks.length - 1 && "border-b border-border/50",
                    isCurrentTrack(track.id) && "bg-primary/10 hover:bg-primary/15",
                    isDragging && "opacity-50 bg-muted"
                )}
                onClick={() => handlePlayTrack(track, index)}
            >
                {/* Track Number / Play Button / Waveform */}
                <div className="w-8 h-8 flex items-center justify-center flex-shrink-0">
                    {isCurrentTrackPlaying(track.id) ? (
                        <div className="relative h-8 w-8 flex items-center justify-center">
                            <AudioWaveform className="group-hover:hidden" />
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-primary hidden group-hover:flex"
                                onClick={(e) => {
                                    e.stopPropagation()
                                    setIsPlaying(false)
                                }}
                            >
                                <Pause className="h-4 w-4 fill-current" />
                            </Button>
                        </div>
                    ) : isCurrentTrack(track.id) ? (
                        <div className="relative h-8 w-8 flex items-center justify-center">
                            <Pause className="h-4 w-4 fill-primary text-primary group-hover:hidden" />
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-primary hidden group-hover:flex"
                                onClick={(e) => {
                                    e.stopPropagation()
                                    setIsPlaying(true)
                                }}
                            >
                                <Play className="h-4 w-4 fill-current" />
                            </Button>
                        </div>
                    ) : (
                        <>
                            <span className="text-muted-foreground text-sm group-hover:hidden">
                                {index + 1}
                            </span>
                            <Play className="h-4 w-4 text-primary fill-primary hidden group-hover:block" />
                        </>
                    )}
                </div>

                {/* Track Info */}
                <div className="flex-1 min-w-0">
                    <p className={cn(
                        "font-medium truncate",
                        isCurrentTrack(track.id) && "text-primary"
                    )}>
                        {track.title}
                    </p>
                    <p className="text-sm text-muted-foreground truncate">
                        {track.artist?.name || 'Unknown Artist'} • {track.album?.title || 'Unknown Album'}
                    </p>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        title="Play Next"
                        onClick={(e) => {
                            e.stopPropagation()
                            playNext(track)
                        }}
                    >
                        <ListPlus className="h-4 w-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        title="Add to Queue"
                        onClick={(e) => {
                            e.stopPropagation()
                            addToQueue(track)
                        }}
                    >
                        <Plus className="h-4 w-4" />
                    </Button>
                    {/* Remove button - only show if not synced */}
                    {!playlist.isSynced && (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            title="Remove from Playlist"
                            onClick={(e) => {
                                e.stopPropagation()
                                handleRemoveTrack(playlistTrack.id, track)
                            }}
                        >
                            <Trash2 className="h-4 w-4" />
                        </Button>
                    )}
                </div>

                {/* Duration */}
                <span className="text-sm text-muted-foreground tabular-nums">
                    {formatDuration(track.duration)}
                </span>

                {/* Drag Handle - at far right, only for non-synced playlists */}
                {isDraggingEnabled && (
                    <div
                        {...attributes}
                        {...listeners}
                        className="cursor-grab active:cursor-grabbing touch-none ml-2"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <GripVertical className="h-4 w-4 text-muted-foreground/50 hover:text-muted-foreground" />
                    </div>
                )}
            </div>
        </TrackContextMenu>
    )
}

export function PlaylistView({ playlistId, onBack }: PlaylistViewProps) {
    const { playTrack, currentTrack, isPlaying, setIsPlaying, playNext, addToQueue, playlists, setPlaylists, navigateToArtist, setSelectedAlbum, library } = usePlayerStore()
    const [playlist, setPlaylist] = React.useState<PlaylistDetail | null>(null)
    const [isLoading, setIsLoading] = React.useState(true)
    const [isEditingName, setIsEditingName] = React.useState(false)
    const [isEditingDescription, setIsEditingDescription] = React.useState(false)
    const [editedName, setEditedName] = React.useState("")
    const [editedDescription, setEditedDescription] = React.useState("")
    const nameInputRef = React.useRef<HTMLInputElement>(null)
    const descriptionInputRef = React.useRef<HTMLTextAreaElement>(null)
    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = React.useState(false)
    const [isDeleting, setIsDeleting] = React.useState(false)
    const coverInputRef = React.useRef<HTMLInputElement>(null)

    // DnD sensors
    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 8,
            },
        }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    )

    // Fetch playlist details
    React.useEffect(() => {
        const fetchPlaylist = async () => {
            setIsLoading(true)
            try {
                const response = await fetch(`/api/playlists/${playlistId}`)
                if (response.ok) {
                    const data = await response.json()
                    setPlaylist(data)
                    setEditedName(data.name)
                    setEditedDescription(data.description || "")
                }
            } catch (error) {
                console.error('Failed to fetch playlist:', error)
            } finally {
                setIsLoading(false)
            }
        }
        fetchPlaylist()
    }, [playlistId])

    // Focus input when editing starts
    React.useEffect(() => {
        if (isEditingName && nameInputRef.current) {
            nameInputRef.current.focus()
            nameInputRef.current.select()
        }
    }, [isEditingName])

    React.useEffect(() => {
        if (isEditingDescription && descriptionInputRef.current) {
            descriptionInputRef.current.focus()
        }
    }, [isEditingDescription])

    // Prepare tracks with metadata for playback
    const tracksWithMetadata = React.useMemo(() => {
        if (!playlist?.tracks) return []
        return playlist.tracks.map(pt => ({
            ...pt.track,
            artist: pt.track.artist,
            album: pt.track.album
        }))
    }, [playlist])

    const handlePlayPlaylist = () => {
        if (tracksWithMetadata.length > 0) {
            playTrack(tracksWithMetadata[0], tracksWithMetadata)
        }
    }

    const handleShufflePlaylist = () => {
        if (tracksWithMetadata.length > 0) {
            const shuffled = [...tracksWithMetadata].sort(() => Math.random() - 0.5)
            playTrack(shuffled[0], shuffled)
        }
    }

    const handlePlayTrack = (track: Track, index: number) => {
        playTrack(tracksWithMetadata[index], tracksWithMetadata)
    }

    const handleRemoveTrack = async (playlistTrackId: string, track: Track) => {
        if (!playlist) return

        // Store original state for undo
        const originalTracks = [...playlist.tracks]
        const removedTrack = originalTracks.find(pt => pt.id === playlistTrackId)
        const removedIndex = originalTracks.findIndex(pt => pt.id === playlistTrackId)

        // Optimistic update
        const updatedTracks = playlist.tracks.filter(pt => pt.id !== playlistTrackId)
        setPlaylist({
            ...playlist,
            tracks: updatedTracks,
            trackCount: updatedTracks.length
        })
        setPlaylists(playlists.map(p =>
            p.id === playlistId ? { ...p, trackCount: updatedTracks.length } : p
        ))

        try {
            const response = await fetch(`/api/playlists/${playlistId}/tracks?playlistTrackId=${playlistTrackId}`, {
                method: 'DELETE'
            })
            if (response.ok) {
                toast.success(`Removed from "${playlist.name}"`, {
                    description: track.title,
                    action: removedTrack ? {
                        label: "Undo",
                        onClick: async () => {
                            // Re-add the track
                            try {
                                const addResponse = await fetch(`/api/playlists/${playlistId}/tracks`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ trackIds: [track.id], force: true })
                                })
                                if (addResponse.ok) {
                                    // Restore track in UI
                                    const newTrack: PlaylistTrackItem = {
                                        ...removedTrack,
                                        position: removedIndex
                                    }
                                    const restoredTracks = [...updatedTracks]
                                    restoredTracks.splice(removedIndex, 0, newTrack)
                                    setPlaylist(prev => prev ? {
                                        ...prev,
                                        tracks: restoredTracks,
                                        trackCount: restoredTracks.length
                                    } : prev)
                                    setPlaylists(playlists.map(p =>
                                        p.id === playlistId ? { ...p, trackCount: restoredTracks.length } : p
                                    ))
                                    toast.success("Restored", { description: track.title })
                                }
                            } catch {
                                toast.error("Failed to restore track")
                            }
                        }
                    } : undefined
                })
            } else {
                // Revert on error
                setPlaylist({ ...playlist, tracks: originalTracks })
                setPlaylists(playlists.map(p =>
                    p.id === playlistId ? { ...p, trackCount: originalTracks.length } : p
                ))
                toast.error("Failed to remove track")
            }
        } catch (error) {
            console.error('Failed to remove track:', error)
            // Revert on error
            setPlaylist({ ...playlist, tracks: originalTracks })
            setPlaylists(playlists.map(p =>
                p.id === playlistId ? { ...p, trackCount: originalTracks.length } : p
            ))
            toast.error("Failed to remove track")
        }
    }

    const handleDeletePlaylist = async () => {
        setIsDeleting(true)
        try {
            const response = await fetch(`/api/playlists/${playlistId}`, {
                method: 'DELETE'
            })
            if (response.ok) {
                // Remove from store
                setPlaylists(playlists.filter(p => p.id !== playlistId))
                toast.success("Playlist deleted", {
                    description: playlist?.name
                })
                // Go back
                onBack()
            } else {
                const error = await response.json()
                toast.error("Failed to delete playlist", {
                    description: error.error || "Please try again"
                })
            }
        } catch (error) {
            console.error('Failed to delete playlist:', error)
            toast.error("Failed to delete playlist")
        } finally {
            setIsDeleting(false)
            setIsDeleteDialogOpen(false)
        }
    }

    const handleSaveName = async () => {
        if (!playlist || editedName.trim() === '') return

        try {
            const response = await fetch(`/api/playlists/${playlistId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: editedName.trim() })
            })
            if (response.ok) {
                setPlaylist({ ...playlist, name: editedName.trim() })
                setPlaylists(playlists.map(p =>
                    p.id === playlistId ? { ...p, name: editedName.trim() } : p
                ))
                setIsEditingName(false)
            }
        } catch (error) {
            console.error('Failed to update playlist name:', error)
        }
    }

    const handleSaveDescription = async () => {
        if (!playlist) return

        try {
            const response = await fetch(`/api/playlists/${playlistId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ description: editedDescription.trim() || null })
            })
            if (response.ok) {
                setPlaylist({ ...playlist, description: editedDescription.trim() || undefined })
                setIsEditingDescription(false)
            }
        } catch (error) {
            console.error('Failed to update playlist description:', error)
        }
    }

    const handleCancelEdit = () => {
        setEditedName(playlist?.name || "")
        setIsEditingName(false)
    }

    const handleCancelDescriptionEdit = () => {
        setEditedDescription(playlist?.description || "")
        setIsEditingDescription(false)
    }

    const handleSetCover = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0]
        if (!file || !playlist) return

        const formData = new FormData()
        formData.append('cover', file)

        try {
            const response = await fetch(`/api/playlists/${playlistId}/cover`, {
                method: 'POST',
                body: formData
            })
            if (response.ok) {
                const result = await response.json()
                setPlaylist({ ...playlist, coverPath: result.coverPath })
                setPlaylists(playlists.map(p =>
                    p.id === playlistId ? { ...p, coverPath: result.coverPath } : p
                ))
                toast.success("Cover updated")
            } else {
                toast.error("Failed to set cover")
            }
        } catch (error) {
            console.error('Failed to set cover:', error)
            toast.error("Failed to set cover")
        }

        // Reset input
        if (coverInputRef.current) {
            coverInputRef.current.value = ''
        }
    }

    const handleRemoveCover = async () => {
        if (!playlist) return

        try {
            const response = await fetch(`/api/playlists/${playlistId}/cover`, {
                method: 'DELETE'
            })
            if (response.ok) {
                setPlaylist({ ...playlist, coverPath: undefined })
                setPlaylists(playlists.map(p =>
                    p.id === playlistId ? { ...p, coverPath: undefined } : p
                ))
                toast.success("Cover removed")
            }
        } catch (error) {
            console.error('Failed to remove cover:', error)
            toast.error("Failed to remove cover")
        }
    }

    const handleDragEnd = async (event: DragEndEvent) => {
        const { active, over } = event

        if (!over || active.id === over.id || !playlist) return

        const oldIndex = playlist.tracks.findIndex(t => t.id === active.id)
        const newIndex = playlist.tracks.findIndex(t => t.id === over.id)

        if (oldIndex === -1 || newIndex === -1) return

        // Optimistically update UI
        const newTracks = arrayMove(playlist.tracks, oldIndex, newIndex)
        setPlaylist({ ...playlist, tracks: newTracks })

        // Persist to backend
        try {
            const orderedTrackIds = newTracks.map(t => t.id)
            const response = await fetch(`/api/playlists/${playlistId}/tracks`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ orderedTrackIds })
            })
            if (!response.ok) {
                // Revert on failure
                setPlaylist(playlist)
                toast.error("Failed to reorder tracks")
            }
        } catch (error) {
            console.error('Failed to reorder tracks:', error)
            setPlaylist(playlist)
            toast.error("Failed to reorder tracks")
        }
    }

    const isCurrentTrackPlaying = (trackId: string) => {
        return currentTrack?.id === trackId && isPlaying
    }

    const isCurrentTrackFn = (trackId: string) => {
        return currentTrack?.id === trackId
    }

    // Prepare tracks for cover art mosaic
    const coverTracks = React.useMemo(() => {
        if (!playlist?.tracks) return []
        return playlist.tracks.map(pt => ({
            id: pt.track.id,
            albumId: pt.track.albumId || ''
        }))
    }, [playlist])

    if (isLoading) {
        return (
            <div className="h-full w-full overflow-auto">
                <div className="sticky top-14 mt-14 z-30 bg-background/60 backdrop-blur-md border-b">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={onBack}
                        className="m-2 gap-1 text-muted-foreground hover:text-foreground"
                    >
                        <ChevronLeft className="h-4 w-4" />
                        Back
                    </Button>
                </div>
                <div className="max-w-4xl mx-auto px-8 pt-8 pb-32">
                    <div className="flex flex-col md:flex-row gap-8 mb-8">
                        <Skeleton className="w-64 h-64 rounded-lg" />
                        <div className="flex flex-col justify-end gap-4">
                            <Skeleton className="h-4 w-20" />
                            <Skeleton className="h-10 w-64" />
                            <Skeleton className="h-4 w-32" />
                            <div className="flex gap-3">
                                <Skeleton className="h-9 w-24" />
                                <Skeleton className="h-9 w-24" />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        )
    }

    if (!playlist) {
        return (
            <div className="h-full w-full flex items-center justify-center">
                <p className="text-muted-foreground">Playlist not found</p>
            </div>
        )
    }

    return (
        <div className="h-full w-full overflow-auto">
            {/* Back button */}
            <div className="sticky top-14 mt-14 z-30 bg-background/60 backdrop-blur-md border-b transition-colors supports-[backdrop-filter]:bg-background/60">
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={onBack}
                    className="m-2 gap-1 text-muted-foreground hover:text-foreground"
                >
                    <ChevronLeft className="h-4 w-4" />
                    Back
                </Button>
            </div>

            <div className="max-w-4xl mx-auto px-8 pt-8 pb-32">
                {/* Playlist Header */}
                <div className="flex flex-col md:flex-row gap-8 mb-8">
                    {/* Cover Art */}
                    <div className="relative group mx-auto md:mx-0">
                        <PlaylistCover
                            tracks={coverTracks}
                            playlistName={playlist.name}
                            coverPath={playlist.coverPath}
                            artworkUrl={playlist.artworkUrl}
                            className="w-64 h-64 md:w-72 md:h-72 flex-shrink-0"
                        />
                        {/* Cover management buttons - only for non-synced */}
                        {!playlist.isSynced && (
                            <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg">
                                <Button
                                    variant="secondary"
                                    size="icon"
                                    onClick={() => coverInputRef.current?.click()}
                                    title="Set cover"
                                >
                                    <ImagePlus className="h-5 w-5" />
                                </Button>
                                {playlist.coverPath && (
                                    <Button
                                        variant="secondary"
                                        size="icon"
                                        onClick={handleRemoveCover}
                                        title="Remove cover"
                                    >
                                        <ImageOff className="h-5 w-5" />
                                    </Button>
                                )}
                            </div>
                        )}
                        <input
                            ref={coverInputRef}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={handleSetCover}
                        />
                    </div>

                    {/* Playlist Info */}
                    <div className="flex flex-col justify-end text-center md:text-left flex-1">
                        <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-1">Playlist</p>

                        {/* Editable Name - only if not synced */}
                        {isEditingName && !playlist.isSynced ? (
                            <div className="flex items-center gap-2 mb-4">
                                <input
                                    ref={nameInputRef}
                                    type="text"
                                    value={editedName}
                                    onChange={(e) => setEditedName(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') handleSaveName()
                                        if (e.key === 'Escape') handleCancelEdit()
                                    }}
                                    className="text-3xl md:text-4xl font-bold tracking-tight bg-transparent border-b-2 border-primary outline-none w-full"
                                />
                                <Button variant="ghost" size="icon" onClick={handleSaveName} className="h-8 w-8">
                                    <Check className="h-4 w-4" />
                                </Button>
                                <Button variant="ghost" size="icon" onClick={handleCancelEdit} className="h-8 w-8">
                                    <X className="h-4 w-4" />
                                </Button>
                            </div>
                        ) : (
                            <div className="flex items-center gap-2 mb-2 group/name">
                                <h1 className="text-3xl md:text-4xl font-bold tracking-tight">{playlist.name}</h1>
                                {/* Show sync indicator OR edit button, but not both */}
                                {playlist.isSynced ? (
                                    <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-600 bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400 rounded-full" title="Synced from Apple Music">
                                        <CloudCog className="h-3 w-3" />
                                        Synced
                                    </span>
                                ) : (
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => setIsEditingName(true)}
                                        className="h-8 w-8 opacity-0 group-hover/name:opacity-100 transition-opacity"
                                    >
                                        <Pencil className="h-4 w-4" />
                                    </Button>
                                )}
                            </div>
                        )}

                        {/* Editable Description */}
                        {isEditingDescription && !playlist.isSynced ? (
                            <div className="mb-4">
                                <Textarea
                                    ref={descriptionInputRef}
                                    value={editedDescription}
                                    onChange={(e) => setEditedDescription(e.target.value)}
                                    placeholder="Add a description..."
                                    className="resize-none min-h-[60px]"
                                    onKeyDown={(e) => {
                                        if (e.key === 'Escape') handleCancelDescriptionEdit()
                                    }}
                                />
                                <div className="flex gap-2 mt-2">
                                    <Button size="sm" onClick={handleSaveDescription}>Save</Button>
                                    <Button size="sm" variant="outline" onClick={handleCancelDescriptionEdit}>Cancel</Button>
                                </div>
                            </div>
                        ) : (
                            <div className="group/desc mb-4">
                                {playlist.description ? (
                                    <div className="flex items-start gap-2">
                                        <p className="text-muted-foreground">{playlist.description}</p>
                                        {!playlist.isSynced && (
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => setIsEditingDescription(true)}
                                                className="h-6 w-6 opacity-0 group-hover/desc:opacity-100 transition-opacity flex-shrink-0"
                                            >
                                                <Pencil className="h-3 w-3" />
                                            </Button>
                                        )}
                                    </div>
                                ) : (
                                    !playlist.isSynced && (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => setIsEditingDescription(true)}
                                            className="text-muted-foreground hover:text-foreground -ml-3"
                                        >
                                            <Plus className="h-4 w-4 mr-1" />
                                            Add description
                                        </Button>
                                    )
                                )}
                            </div>
                        )}

                        <p className="text-sm text-muted-foreground mb-6">
                            {playlist.trackCount} {playlist.trackCount === 1 ? 'song' : 'songs'}
                            {playlist.tracks.length > 0 && ` • ${formatTotalDuration(playlist.tracks)}`}
                        </p>

                        {/* Action Buttons */}
                        <div className="flex gap-3 justify-center md:justify-start flex-wrap">
                            <Button
                                size="sm"
                                onClick={handlePlayPlaylist}
                                className="px-6 gap-2"
                                disabled={playlist.tracks.length === 0}
                            >
                                <Play className="h-4 w-4 fill-current" />
                                Play
                            </Button>
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={handleShufflePlaylist}
                                className="px-6 gap-2"
                                disabled={playlist.tracks.length === 0}
                            >
                                <Shuffle className="h-4 w-4" />
                                Shuffle
                            </Button>
                            {/* Delete button */}
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setIsDeleteDialogOpen(true)}
                                className="px-6 gap-2 text-destructive hover:text-destructive hover:bg-destructive/10"
                            >
                                <Trash2 className="h-4 w-4" />
                                Delete
                            </Button>
                        </div>
                    </div>
                </div>

                {/* Track List */}
                {playlist.tracks.length === 0 ? (
                    <div className="rounded-xl border bg-card/50 backdrop-blur-sm p-8 text-center">
                        <p className="text-muted-foreground mb-2">This playlist is empty</p>
                        <p className="text-sm text-muted-foreground">Add songs from your library to get started</p>
                    </div>
                ) : (
                    <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={handleDragEnd}
                    >
                        <SortableContext
                            items={playlist.tracks.map(t => t.id)}
                            strategy={verticalListSortingStrategy}
                        >
                            <div className="rounded-xl overflow-hidden border bg-card/50 backdrop-blur-sm">
                                {playlist.tracks.map((playlistTrack, index) => {
                                    const track = playlistTrack.track

                                    // Helper to navigate to album
                                    const handleGoToAlbum = () => {
                                        if (track.albumId) {
                                            // Find album in library
                                            for (const artist of library) {
                                                const album = artist.albums.find(a => a.id === track.albumId)
                                                if (album) {
                                                    setSelectedAlbum({
                                                        id: album.id,
                                                        title: album.title,
                                                        tracks: album.tracks,
                                                        artistName: artist.name
                                                    })
                                                    break
                                                }
                                            }
                                        }
                                    }

                                    return (
                                        <SortableTrackRow
                                            key={playlistTrack.id}
                                            playlistTrack={playlistTrack}
                                            index={index}
                                            playlist={playlist}
                                            isCurrentTrack={isCurrentTrackFn}
                                            isCurrentTrackPlaying={isCurrentTrackPlaying}
                                            handlePlayTrack={handlePlayTrack}
                                            setIsPlaying={setIsPlaying}
                                            playNext={playNext}
                                            addToQueue={addToQueue}
                                            handleRemoveTrack={handleRemoveTrack}
                                            navigateToArtist={navigateToArtist}
                                            handleGoToAlbum={handleGoToAlbum}
                                            isDraggingEnabled={!playlist.isSynced}
                                        />
                                    )
                                })}
                            </div>
                        </SortableContext>
                    </DndContext>
                )}
            </div>

            {/* Delete Playlist Confirmation Dialog */}
            <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete Playlist</AlertDialogTitle>
                        <AlertDialogDescription>
                            Are you sure you want to delete <strong>&quot;{playlist.name}&quot;</strong>?
                            {playlist.isSynced ? (
                                <>
                                    <br /><br />
                                    This will remove the local copy and stop future syncs for this playlist.
                                    The playlist will remain on Apple Music.
                                </>
                            ) : (
                                " This action cannot be undone."
                            )}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={handleDeletePlaylist}
                            disabled={isDeleting}
                        >
                            {isDeleting ? "Deleting..." : "Delete"}
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}
