"use client"

import React, { useEffect, useState, useRef, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { RefreshCw, Check, AlertCircle, Music2, ExternalLink, Settings2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { toast } from "sonner"
import { usePlayerStore } from "@/lib/store"
import { cn } from "@/lib/utils"

// Codec labels for display
const CODEC_LABELS: Record<string, { label: string; category: 'standard' | 'hires' | 'spatial' }> = {
    'aac-legacy': { label: 'AAC', category: 'standard' },
    'aac-he-legacy': { label: 'AAC-HE', category: 'standard' },
    'aac': { label: 'AAC 48kHz', category: 'standard' },
    'aac-he': { label: 'AAC-HE 48kHz', category: 'standard' },
    'alac': { label: 'Lossless', category: 'hires' },
    'atmos': { label: 'Dolby Atmos', category: 'spatial' },
    'aac-binaural': { label: 'Spatial', category: 'spatial' },
    'aac-he-binaural': { label: 'Spatial HE', category: 'spatial' },
    'aac-downmix': { label: 'Downmix', category: 'standard' },
    'aac-he-downmix': { label: 'HE Downmix', category: 'standard' },
    'ac3': { label: 'AC3', category: 'spatial' },
}

const ALL_CODECS = [
    'aac-legacy', 'aac-he-legacy', 'aac', 'aac-he', 'alac',
    'atmos', 'aac-binaural', 'aac-he-binaural', 'aac-downmix', 'aac-he-downmix', 'ac3'
]

interface SyncedPlaylist {
    id: string
    name: string
    appleMusicId: string
    globalId?: string | null
    lastSyncedAt: string | null
    appleLastModifiedDate: string | null
    artworkUrl: string | null
    trackCount: number
    selectedCodecs: string | null // Comma-separated codecs for this playlist
}

interface SyncStatusData {
    syncEnabled: boolean
    syncInterval: number
    autoSyncOnChange: boolean
    lastSyncCheck: string | null
    storefront: string
    syncedPlaylists: SyncedPlaylist[]
}

export function SyncStatus() {
    const { setPlaylists } = usePlayerStore()
    const [data, setData] = useState<SyncStatusData | null>(null)
    const [loading, setLoading] = useState(true)
    const [refreshing, setRefreshing] = useState(false)
    const [syncing, setSyncing] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const prevSyncTimesRef = useRef<Map<string, string | null>>(new Map())

    // Function to refresh playlists in the global store
    const refreshPlaylists = useCallback(async () => {
        try {
            const response = await fetch('/api/playlists')
            if (response.ok) {
                const playlists = await response.json()
                setPlaylists(playlists)
            }
        } catch (error) {
            console.error('Failed to refresh playlists:', error)
        }
    }, [setPlaylists])

    const fetchStatus = useCallback(async (showRefreshState = false) => {
        if (showRefreshState) setRefreshing(true)
        try {
            const res = await fetch('/api/sync/status')
            if (res.ok) {
                const json: SyncStatusData = await res.json()

                // Check if any playlist was recently synced (for toast)
                if (data && json.syncedPlaylists) {
                    for (const playlist of json.syncedPlaylists) {
                        const prevSyncTime = prevSyncTimesRef.current.get(playlist.id)
                        if (prevSyncTime && playlist.lastSyncedAt &&
                            playlist.lastSyncedAt !== prevSyncTime) {
                            // Playlist was just synced!
                            toast.success(`Playlist synced`, {
                                description: `"${playlist.name}" has been updated`,
                                action: {
                                    label: "View",
                                    onClick: () => {
                                        window.location.href = `/playlist/${playlist.id}`
                                    }
                                }
                            })
                            // Refresh playlists in the store
                            refreshPlaylists()
                        }
                        prevSyncTimesRef.current.set(playlist.id, playlist.lastSyncedAt)
                    }
                } else if (json.syncedPlaylists) {
                    // First load - just store the times
                    for (const playlist of json.syncedPlaylists) {
                        prevSyncTimesRef.current.set(playlist.id, playlist.lastSyncedAt)
                    }
                }

                setData(json)
                setError(null)
            } else {
                setError('Failed to fetch sync status')
            }
        } catch (err) {
            setError('Connection error')
        } finally {
            setLoading(false)
            setRefreshing(false)
        }
    }, [data])

    const triggerSync = async () => {
        setSyncing(true)
        try {
            const res = await fetch('/api/sync/status', { method: 'POST' })
            if (res.ok) {
                toast.success('Sync check triggered')
                // Refresh status after a short delay
                setTimeout(() => fetchStatus(true), 2000)
            } else {
                const error = await res.json()
                toast.error('Failed to trigger sync', { description: error.error })
            }
        } catch (err) {
            toast.error('Failed to trigger sync')
        } finally {
            setSyncing(false)
        }
    }

    const updatePlaylistCodecs = async (playlistId: string, codecs: string[]) => {
        try {
            const res = await fetch(`/api/playlists/${playlistId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ selectedCodecs: codecs.join(',') })
            })
            if (res.ok) {
                // Update local state
                setData(prev => {
                    if (!prev) return prev
                    return {
                        ...prev,
                        syncedPlaylists: prev.syncedPlaylists.map(p =>
                            p.id === playlistId ? { ...p, selectedCodecs: codecs.join(',') } : p
                        )
                    }
                })
                toast.success('Codecs updated')
            } else {
                toast.error('Failed to update codecs')
            }
        } catch (err) {
            toast.error('Failed to update codecs')
        }
    }

    useEffect(() => {
        fetchStatus()
        // Refresh every 5 seconds for faster updates
        const interval = setInterval(() => fetchStatus(false), 5000)
        return () => clearInterval(interval)
    }, []) // Don't include fetchStatus to avoid re-creating interval

    const formatDate = (dateStr: string | null) => {
        if (!dateStr) return 'Never'
        const date = new Date(dateStr)
        return new Intl.DateTimeFormat('en', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        }).format(date)
    }

    const getIntervalText = (minutes: number) => {
        if (minutes < 1) return `${Math.round(minutes * 60)} seconds`
        if (minutes === 1) return '1 minute'
        if (minutes < 60) return `${minutes} minutes`
        const hours = Math.floor(minutes / 60)
        return hours === 1 ? '1 hour' : `${hours} hours`
    }

    const getAppleMusicUrl = (playlist: SyncedPlaylist, storefront: string) => {
        // Build URL using the storefront from settings
        // For global IDs (pl.u-xxx), use the public playlist URL format
        const id = playlist.globalId || playlist.appleMusicId
        return `https://music.apple.com/${storefront}/playlist/${id}`
    }

    if (loading) {
        return (
            <Card className="w-full">
                <CardContent className="flex items-center justify-center py-8">
                    <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
                </CardContent>
            </Card>
        )
    }

    if (error || !data) {
        return (
            <Card className="w-full">
                <CardContent className="flex items-center justify-center py-8 text-muted-foreground">
                    <AlertCircle className="h-5 w-5 mr-2" />
                    {error || 'Unable to load sync status'}
                </CardContent>
            </Card>
        )
    }

    return (
        <Card className="w-full">
            <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                    <div>
                        <CardTitle className="text-lg flex items-center gap-2">
                            <RefreshCw className={`h-5 w-5 ${data.syncEnabled ? 'text-green-500' : 'text-muted-foreground'}`} />
                            Playlist Sync Status
                        </CardTitle>
                        <CardDescription>
                            {data.syncEnabled
                                ? `Checking every ${getIntervalText(data.syncInterval)}`
                                : 'Sync is disabled - enable in Settings'
                            }
                        </CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={syncing || !data.syncEnabled}
                            onClick={triggerSync}
                            title="Trigger manual sync check"
                        >
                            <RefreshCw className={`h-4 w-4 mr-1 ${syncing ? 'animate-spin' : ''}`} />
                            Sync Now
                        </Button>
                        <div className={`px-3 py-1 rounded-full text-xs font-medium ${data.syncEnabled
                            ? 'bg-green-500/10 text-green-500'
                            : 'bg-muted text-muted-foreground'
                            }`}>
                            {data.syncEnabled ? 'Active' : 'Disabled'}
                        </div>
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                {data.lastSyncCheck && (
                    <p className="text-xs text-muted-foreground mb-4">
                        Last check: {formatDate(data.lastSyncCheck)}
                    </p>
                )}

                {data.syncedPlaylists.length === 0 ? (
                    <div className="text-center py-6 text-muted-foreground">
                        <Music2 className="h-8 w-8 mx-auto mb-2 opacity-50" />
                        <p className="text-sm">No synced playlists</p>
                        <p className="text-xs">Import a playlist with sync enabled to see it here</p>
                    </div>
                ) : (
                    <div className="space-y-2 max-h-80 overflow-y-auto">
                        {data.syncedPlaylists.map((playlist) => {
                            const playlistCodecs = playlist.selectedCodecs?.split(',').filter(c => c) || ['aac-legacy']
                            return (
                                <div
                                    key={playlist.id}
                                    className="flex flex-col gap-2 p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
                                >
                                    <div className="flex items-center gap-3">
                                        {playlist.artworkUrl ? (
                                            <img
                                                src={playlist.artworkUrl}
                                                alt=""
                                                className="w-10 h-10 rounded object-cover"
                                            />
                                        ) : (
                                            <div className="w-10 h-10 rounded bg-muted flex items-center justify-center">
                                                <Music2 className="h-5 w-5 text-muted-foreground" />
                                            </div>
                                        )}
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium truncate">
                                                {playlist.name}
                                            </p>
                                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                                <span>{playlist.trackCount} tracks</span>
                                                <span>•</span>
                                                <span>Synced {formatDate(playlist.lastSyncedAt)}</span>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Check className="h-4 w-4 text-green-500" />
                                            <a
                                                href={getAppleMusicUrl(playlist, data.storefront)}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-muted-foreground hover:text-foreground transition-colors"
                                                title="Open in Apple Music"
                                            >
                                                <ExternalLink className="h-4 w-4" />
                                            </a>
                                        </div>
                                    </div>
                                    {/* Codec selection row */}
                                    <div className="flex items-center gap-2 flex-wrap">
                                        {playlistCodecs.map(codec => {
                                            const info = CODEC_LABELS[codec] || { label: codec.toUpperCase(), category: 'standard' }
                                            return (
                                                <span
                                                    key={codec}
                                                    className={cn(
                                                        "px-2 py-0.5 rounded text-[10px] font-medium",
                                                        info.category === 'hires'
                                                            ? "bg-purple-500/20 text-purple-600 dark:text-purple-300"
                                                            : info.category === 'spatial'
                                                                ? "bg-blue-500/20 text-blue-600 dark:text-blue-300"
                                                                : "bg-primary/20 text-primary"
                                                    )}
                                                >
                                                    {info.label}
                                                </span>
                                            )
                                        })}
                                        <Popover>
                                            <PopoverTrigger asChild>
                                                <button className="p-1 rounded hover:bg-muted-foreground/10 text-muted-foreground hover:text-foreground transition-colors" title="Edit codecs">
                                                    <Settings2 className="h-3.5 w-3.5" />
                                                </button>
                                            </PopoverTrigger>
                                            <PopoverContent className="w-64 p-3" align="start">
                                                <p className="text-xs font-medium mb-2">Select codecs for sync</p>
                                                <div className="flex flex-wrap gap-1.5">
                                                    {ALL_CODECS.map(codec => {
                                                        const isSelected = playlistCodecs.includes(codec)
                                                        const info = CODEC_LABELS[codec]
                                                        return (
                                                            <button
                                                                key={codec}
                                                                onClick={() => {
                                                                    const newCodecs = isSelected
                                                                        ? playlistCodecs.filter(c => c !== codec)
                                                                        : [...playlistCodecs, codec]
                                                                    if (newCodecs.length > 0) {
                                                                        updatePlaylistCodecs(playlist.id, newCodecs)
                                                                    }
                                                                }}
                                                                className={cn(
                                                                    "px-2 py-0.5 rounded text-[10px] font-medium transition-all border",
                                                                    isSelected
                                                                        ? info.category === 'hires'
                                                                            ? "border-purple-500 bg-purple-500/20 text-purple-600 dark:text-purple-300"
                                                                            : info.category === 'spatial'
                                                                                ? "border-blue-500 bg-blue-500/20 text-blue-600 dark:text-blue-300"
                                                                                : "border-primary bg-primary/20 text-primary"
                                                                        : "border-transparent bg-muted/50 text-muted-foreground hover:bg-muted"
                                                                )}
                                                            >
                                                                {info.label}
                                                            </button>
                                                        )
                                                    })}
                                                </div>
                                                <p className="text-[10px] text-muted-foreground mt-2">
                                                    Unavailable codecs will be skipped per track
                                                </p>
                                            </PopoverContent>
                                        </Popover>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                )}
            </CardContent>
        </Card>
    )
}
