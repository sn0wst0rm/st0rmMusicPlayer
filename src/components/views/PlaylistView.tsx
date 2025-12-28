"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { AudioWaveform } from "@/components/ui/audio-waveform"
import { Play, Shuffle, ChevronLeft, Pause, ListPlus, Plus, Trash2, Pencil, Check, X, CloudCog } from "lucide-react"
import { cn } from "@/lib/utils"
import { usePlayerStore, Track } from "@/lib/store"
import { PlaylistDetail, PlaylistTrackItem } from "@/types/music"
import { PlaylistCover } from "@/components/ui/playlist-cover"

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

export function PlaylistView({ playlistId, onBack }: PlaylistViewProps) {
    const { playTrack, currentTrack, isPlaying, setIsPlaying, playNext, addToQueue, playlists, setPlaylists } = usePlayerStore()
    const [playlist, setPlaylist] = React.useState<PlaylistDetail | null>(null)
    const [isLoading, setIsLoading] = React.useState(true)
    const [isEditingName, setIsEditingName] = React.useState(false)
    const [editedName, setEditedName] = React.useState("")
    const nameInputRef = React.useRef<HTMLInputElement>(null)

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

    const handleRemoveTrack = async (playlistTrackId: string) => {
        try {
            const response = await fetch(`/api/playlists/${playlistId}/tracks?playlistTrackId=${playlistTrackId}`, {
                method: 'DELETE'
            })
            if (response.ok && playlist) {
                const updatedTracks = playlist.tracks.filter(pt => pt.id !== playlistTrackId)
                setPlaylist({
                    ...playlist,
                    tracks: updatedTracks,
                    trackCount: updatedTracks.length
                })
                // Update playlists in store
                setPlaylists(playlists.map(p =>
                    p.id === playlistId ? { ...p, trackCount: updatedTracks.length } : p
                ))
            }
        } catch (error) {
            console.error('Failed to remove track:', error)
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

    const handleCancelEdit = () => {
        setEditedName(playlist?.name || "")
        setIsEditingName(false)
    }

    const isCurrentTrackPlaying = (trackId: string) => {
        return currentTrack?.id === trackId && isPlaying
    }

    const isCurrentTrack = (trackId: string) => {
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
                    {/* Cover Art - 4-quadrant mosaic */}
                    <PlaylistCover
                        tracks={coverTracks}
                        playlistName={playlist.name}
                        className="w-64 h-64 md:w-72 md:h-72 flex-shrink-0 mx-auto md:mx-0"
                    />

                    {/* Playlist Info */}
                    <div className="flex flex-col justify-end text-center md:text-left">
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
                                    className="text-3xl md:text-4xl font-bold tracking-tight bg-transparent border-b-2 border-primary outline-none"
                                />
                                <Button variant="ghost" size="icon" onClick={handleSaveName} className="h-8 w-8">
                                    <Check className="h-4 w-4" />
                                </Button>
                                <Button variant="ghost" size="icon" onClick={handleCancelEdit} className="h-8 w-8">
                                    <X className="h-4 w-4" />
                                </Button>
                            </div>
                        ) : (
                            <div className="flex items-center gap-2 mb-4 group">
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
                                        className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                                    >
                                        <Pencil className="h-4 w-4" />
                                    </Button>
                                )}
                            </div>
                        )}

                        {playlist.description && (
                            <p className="text-muted-foreground mb-4">{playlist.description}</p>
                        )}

                        <p className="text-sm text-muted-foreground mb-6">
                            {playlist.trackCount} {playlist.trackCount === 1 ? 'song' : 'songs'}
                            {playlist.tracks.length > 0 && ` • ${formatTotalDuration(playlist.tracks)}`}
                        </p>

                        {/* Action Buttons */}
                        <div className="flex gap-3 justify-center md:justify-start">
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
                    <div className="rounded-xl overflow-hidden border bg-card/50 backdrop-blur-sm">
                        {playlist.tracks.map((playlistTrack, index) => {
                            const track = playlistTrack.track
                            return (
                                <div
                                    key={playlistTrack.id}
                                    onClick={() => handlePlayTrack(track, index)}
                                    className={cn(
                                        "flex items-center gap-4 px-4 py-3 hover:bg-muted/50 cursor-pointer transition-colors group",
                                        index !== playlist.tracks.length - 1 && "border-b border-border/50",
                                        isCurrentTrack(track.id) && "bg-primary/10 hover:bg-primary/15"
                                    )}
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
                                                    handleRemoveTrack(playlistTrack.id)
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
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>
        </div>
    )
}
