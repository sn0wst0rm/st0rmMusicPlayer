"use client"

import * as React from "react"
import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { usePlayerStore } from "@/lib/store"
import {
    Settings2,
    Download,
    Loader2,
    CheckCircle2,
    XCircle,
    Music,
    Link2,
    RefreshCw,
    Trash2
} from "lucide-react"
import { cn } from "@/lib/utils"
import { ImportSettings } from "./ImportSettings"
import { SyncStatus } from "./SyncStatus"
import { toast } from "sonner"

interface ValidationResult {
    valid: boolean
    type: string
    title: string
    artist?: string
    artwork_url?: string
    track_count?: number
    apple_music_id?: string
    extracted_url?: string  // Clean URL extracted from input text
    global_id?: string // Global playlist ID (pl.u-xxx)
    description?: string
    error?: string
}

interface ImportJob {
    id: string
    url: string
    type: string
    title: string
    artist?: string
    artworkUrl?: string
    status: string
    progress: number
    tracksTotal?: number
    tracksComplete: number
    error?: string
    importedAlbumId?: string
    importedArtistId?: string
    importedPlaylistId?: string
    createdAt: string
}

export function ImportView() {
    const { gamdlServiceOnline, setGamdlServiceOnline, setLibrary, setSelectedAlbum, library, setPlaylists, navigateToPlaylist } = usePlayerStore()

    const [url, setUrl] = useState("")
    const [isValidating, setIsValidating] = useState(false)
    const [validationResult, setValidationResult] = useState<ValidationResult | null>(null)
    const [batchResults, setBatchResults] = useState<ValidationResult[]>([])
    const [isDownloading, setIsDownloading] = useState(false)
    const [downloadProgress, setDownloadProgress] = useState<{ current: number, total: number } | null>(null)
    const [importJobs, setImportJobs] = useState<ImportJob[]>([])
    const [showSettings, setShowSettings] = useState(false)
    const [cookiesConfigured, setCookiesConfigured] = useState(false)

    // Check service health on mount
    const checkServiceHealth = useCallback(async () => {
        try {
            const res = await fetch('/api/import/settings')
            if (res.ok) {
                const data = await res.json()
                setGamdlServiceOnline(data.serviceOnline)
                setCookiesConfigured(data.cookiesConfigured)
            }
        } catch {
            setGamdlServiceOnline(false)
        }
    }, [setGamdlServiceOnline])

    useEffect(() => {
        checkServiceHealth()
        // Fetch existing import jobs
        fetchImportJobs()
    }, [checkServiceHealth])

    const fetchImportJobs = async () => {
        try {
            const res = await fetch('/api/import/start')
            if (res.ok) {
                const jobs = await res.json()
                setImportJobs(jobs)
            }
        } catch (err) {
            console.error('Failed to fetch import jobs:', err)
        }
    }

    // Validate URL when it changes
    useEffect(() => {
        // Clear previous results immediately when URL changes
        setValidationResult(null)
        setBatchResults([])

        if (!url || url.length < 10) {
            return
        }

        // Debounce validation
        const timeout = setTimeout(async () => {
            if (!url.includes('music.apple.com')) {
                setValidationResult({
                    valid: false,
                    type: 'unknown',
                    title: '',
                    error: 'Please enter a valid Apple Music URL'
                })
                return
            }

            setIsValidating(true)
            try {
                // Use batch validation to detect multiple URLs
                const res = await fetch('/api/import/validate-batch', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: url })
                })
                const result = await res.json()

                if (result.items && result.items.length > 0) {
                    if (result.items.length === 1) {
                        // Single URL - use normal flow
                        setValidationResult(result.items[0])
                        setBatchResults([])
                    } else {
                        // Multiple URLs - show batch UI
                        setValidationResult(null)
                        setBatchResults(result.items)
                    }
                } else {
                    setValidationResult({
                        valid: false,
                        type: 'unknown',
                        title: '',
                        error: 'No valid Apple Music URLs found'
                    })
                }
            } catch {
                setValidationResult({
                    valid: false,
                    type: 'unknown',
                    title: '',
                    error: 'Failed to validate URL'
                })
            } finally {
                setIsValidating(false)
            }
        }, 500)

        return () => clearTimeout(timeout)
    }, [url])

    const handleDownload = async () => {
        if (!validationResult?.valid || !url) return

        setIsDownloading(true)
        setDownloadProgress(null)

        try {
            // Start the download job - use extracted_url if available (handles embedded URLs)
            const downloadUrl = validationResult.extracted_url || url
            const startRes = await fetch('/api/import/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url: downloadUrl,
                    type: validationResult.type,
                    title: validationResult.title,
                    artist: validationResult.artist,
                    artworkUrl: validationResult.artwork_url,
                    description: validationResult.description,
                    globalId: validationResult.global_id
                })
            })

            if (!startRes.ok) {
                const error = await startRes.json()
                throw new Error(error.error || 'Failed to start download')
            }

            const { jobId } = await startRes.json()

            // Connect to SSE stream for progress
            const eventSource = new EventSource(`/api/import/status/${jobId}`)
            let completed = false

            eventSource.addEventListener('track_complete', (e) => {
                const data = JSON.parse(e.data)
                setDownloadProgress({ current: data.current, total: data.total })
            })

            eventSource.addEventListener('already_exists', (e) => {
                const data = JSON.parse(e.data)
                console.log('Playlist already exists:', data.message)
                // Mark as completed to prevent SSE error handler from firing
                completed = true
                // Show notification to user
                toast.error('Playlist Already Imported', {
                    description: data.message,
                })
                // Clean up state
                eventSource.close()
                setIsDownloading(false)
                setDownloadProgress(null)
                setUrl('')
                setValidationResult(null)
                fetchImportJobs()
            })

            eventSource.addEventListener('complete', (e) => {
                completed = true
                eventSource.close()
                setIsDownloading(false)
                setDownloadProgress(null)

                // Parse completion data for navigation
                let completeData: { importedAlbumId?: string; importedPlaylistId?: string; type?: string } = {}
                try {
                    completeData = JSON.parse(e.data)
                } catch {
                    // Ignore parse errors
                }

                // Show toast notification with action button
                const importType = validationResult?.type || completeData.type || 'content'
                const title = validationResult?.title || 'Content'

                toast.success(`${title} imported successfully!`, {
                    description: `Your ${importType} has been added to your library.`,
                    action: {
                        label: 'Open',
                        onClick: () => {
                            // Navigate based on type and imported IDs
                            if (completeData.importedPlaylistId && importType === 'playlist') {
                                navigateToPlaylist(completeData.importedPlaylistId)
                            } else if (completeData.importedAlbumId) {
                                // Refresh library to show updated albums
                                // TODO: Add navigateToAlbum function to store
                                refreshLibrary()
                            }
                        }
                    }
                })

                setUrl('')
                setValidationResult(null)
                fetchImportJobs()
                // Refresh library and playlists
                refreshLibrary()
                refreshPlaylists()
            })

            // SSE triggers 'error' event when connection closes (even normally after complete)
            // Only log/handle if it occurred before completion
            eventSource.onerror = () => {
                if (!completed) {
                    console.error('SSE connection error during download')
                    eventSource.close()
                    setIsDownloading(false)
                }
            }

        } catch (err) {
            console.error('Download error:', err)
            setIsDownloading(false)
        }
    }

    const refreshLibrary = async () => {
        try {
            const res = await fetch('/api/library')
            if (res.ok) {
                const data = await res.json()
                setLibrary(data)
            }
        } catch (err) {
            console.error('Error refreshing library:', err)
        }
    }

    const refreshPlaylists = async () => {
        try {
            const res = await fetch('/api/playlists')
            if (res.ok) {
                const data = await res.json()
                setPlaylists(data)
            }
        } catch (err) {
            console.error('Error refreshing playlists:', err)
        }
    }

    // Download all items in batch sequentially
    const handleBatchDownload = async () => {
        if (batchResults.length === 0) return

        setIsDownloading(true)
        let totalCompleted = 0

        for (let i = 0; i < batchResults.length; i++) {
            const item = batchResults[i]
            if (!item.valid || !item.extracted_url) continue

            setDownloadProgress({ current: i + 1, total: batchResults.length })

            try {
                const startRes = await fetch('/api/import/start', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        url: item.extracted_url,
                        type: item.type,
                        title: item.title,
                        artist: item.artist,
                        artworkUrl: item.artwork_url,
                        description: item.description,
                        globalId: item.global_id
                    })
                })

                if (!startRes.ok) continue

                const { jobId } = await startRes.json()

                // Wait for this download to complete before starting next
                await new Promise<void>((resolve) => {
                    const eventSource = new EventSource(`/api/import/status/${jobId}`)

                    eventSource.addEventListener('complete', () => {
                        eventSource.close()
                        totalCompleted++
                        resolve()
                    })

                    eventSource.addEventListener('error', () => {
                        eventSource.close()
                        resolve()
                    })
                })
            } catch (err) {
                console.error(`Batch download error for ${item.title}:`, err)
            }
        }

        setIsDownloading(false)
        setDownloadProgress(null)
        setUrl('')
        setBatchResults([])
        fetchImportJobs()
        refreshLibrary()
    }

    return (
        <div className="flex flex-col h-full overflow-hidden relative">
            {/* Header */}
            <div className="flex items-center justify-between px-8 py-6 pb-4 pt-16 border-b">
                <div className="space-y-1">
                    <h1 className="text-3xl font-bold tracking-tight">Import</h1>
                    <p className="text-muted-foreground">
                        Download music from Apple Music
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    {/* Service status indicator */}
                    <div className={cn(
                        "flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium",
                        gamdlServiceOnline
                            ? "bg-green-500/10 text-green-600 dark:text-green-400"
                            : "bg-red-500/10 text-red-600 dark:text-red-400"
                    )}>
                        <div className={cn(
                            "w-2 h-2 rounded-full",
                            gamdlServiceOnline ? "bg-green-500" : "bg-red-500"
                        )} />
                        {gamdlServiceOnline ? "Service Online" : "Service Offline"}
                    </div>
                    <Button
                        variant="outline"
                        size="icon"
                        onClick={() => setShowSettings(true)}
                    >
                        <Settings2 className="h-4 w-4" />
                    </Button>
                </div>
            </div>

            {/* Main content */}
            <div className="flex-1 overflow-auto px-8 py-6">
                {/* URL Input */}
                <div className="max-w-2xl mx-auto space-y-6">
                    <div className="space-y-2">
                        <label className="text-sm font-medium">Apple Music URL</label>
                        <div className="relative">
                            <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Paste Apple Music song, album, or playlist URL..."
                                value={url}
                                onChange={(e) => setUrl(e.target.value)}
                                className="pl-10 pr-10"
                                disabled={isDownloading}
                            />
                            {isValidating && (
                                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
                            )}
                            {!isValidating && (validationResult || batchResults.length > 0) && (
                                (validationResult?.valid || batchResults.length > 0) ? (
                                    <CheckCircle2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-green-500" />
                                ) : (
                                    <XCircle className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-red-500" />
                                )
                            )}
                        </div>
                        {validationResult?.error && (
                            <p className="text-sm text-red-500">{validationResult.error}</p>
                        )}
                    </div>

                    {/* Single Item Preview Card */}
                    {validationResult?.valid && (
                        <div className="flex items-center gap-4 p-4 rounded-lg bg-secondary/30 border">
                            <div className="h-16 w-16 rounded-md bg-secondary flex items-center justify-center overflow-hidden flex-shrink-0">
                                {validationResult.artwork_url ? (
                                    <img
                                        src={validationResult.artwork_url}
                                        alt={validationResult.title}
                                        className="h-full w-full object-cover"
                                    />
                                ) : (
                                    <Music className="h-8 w-8 text-muted-foreground" />
                                )}
                            </div>
                            <div className="flex-1 min-w-0">
                                <h3 className="font-semibold truncate">{validationResult.title}</h3>
                                {validationResult.artist && (
                                    <p className="text-sm text-muted-foreground truncate">
                                        {validationResult.artist}
                                    </p>
                                )}
                                <p className="text-xs text-muted-foreground capitalize">
                                    {validationResult.type}
                                    {validationResult.track_count && ` • ${validationResult.track_count} tracks`}
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Batch Preview - Multiple Items */}
                    {batchResults.length > 0 && (
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <p className="text-sm font-medium text-muted-foreground">
                                    {batchResults.length} items found
                                </p>
                            </div>
                            <div className="space-y-2 max-h-64 overflow-y-auto rounded-lg border bg-secondary/30 p-2">
                                {batchResults.map((item, index) => (
                                    <div key={index} className="flex items-center gap-3 p-2 rounded-md bg-background/50">
                                        <div className="h-10 w-10 rounded bg-secondary flex items-center justify-center overflow-hidden flex-shrink-0">
                                            {item.artwork_url ? (
                                                <img
                                                    src={item.artwork_url}
                                                    alt={item.title}
                                                    className="h-full w-full object-cover"
                                                />
                                            ) : (
                                                <Music className="h-5 w-5 text-muted-foreground" />
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="font-medium text-sm truncate">{item.title}</p>
                                            <p className="text-xs text-muted-foreground truncate">
                                                {item.artist && `${item.artist} • `}
                                                <span className="capitalize">{item.type}</span>
                                                {item.track_count && ` • ${item.track_count} tracks`}
                                            </p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Warnings */}
                    {!cookiesConfigured && (
                        <div className="flex items-center gap-3 p-4 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400">
                            <Settings2 className="h-5 w-5 flex-shrink-0" />
                            <div className="text-sm">
                                <p className="font-medium">Apple Music cookies required</p>
                                <p className="text-amber-600/80 dark:text-amber-400/80">
                                    Configure your cookies in settings to start downloading.
                                </p>
                            </div>
                            <Button
                                variant="outline"
                                size="sm"
                                className="ml-auto"
                                onClick={() => setShowSettings(true)}
                            >
                                Open Settings
                            </Button>
                        </div>
                    )}

                    {/* Download/Sync Button */}
                    <Button
                        size="lg"
                        className="w-full"
                        disabled={
                            (!validationResult?.valid && batchResults.length === 0) ||
                            isDownloading ||
                            !gamdlServiceOnline ||
                            !cookiesConfigured
                        }
                        onClick={batchResults.length > 0 ? handleBatchDownload : handleDownload}
                    >
                        {isDownloading ? (
                            <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                {downloadProgress
                                    ? batchResults.length > 0
                                        ? `Downloading ${downloadProgress.current}/${downloadProgress.total} items...`
                                        : `${validationResult?.type === 'playlist' ? 'Syncing' : 'Downloading'} ${downloadProgress.current}/${downloadProgress.total}...`
                                    : batchResults.length > 0 ? 'Starting batch download...' : validationResult?.type === 'playlist' ? 'Starting sync...' : 'Starting download...'}
                            </>
                        ) : batchResults.length > 0 ? (
                            <>
                                <Download className="h-4 w-4 mr-2" />
                                Download All ({batchResults.length} items)
                            </>
                        ) : validationResult?.type === 'playlist' ? (
                            <>
                                <RefreshCw className="h-4 w-4 mr-2" />
                                Sync Playlist
                            </>
                        ) : (
                            <>
                                <Download className="h-4 w-4 mr-2" />
                                Download
                            </>
                        )}
                    </Button>
                </div>

                {/* Recent Imports */}
                {importJobs.length > 0 && (
                    <div className="max-w-2xl mx-auto mt-12">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold">Recent Imports</h2>
                            <div className="flex gap-2">
                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="text-muted-foreground hover:text-destructive"
                                        >
                                            <Trash2 className="h-4 w-4 mr-2" />
                                            Clear
                                        </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>Clear Import History</AlertDialogTitle>
                                            <AlertDialogDescription>
                                                This will permanently delete all import history records. This action cannot be undone.
                                            </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                                            <AlertDialogAction
                                                onClick={async () => {
                                                    await fetch('/api/import/history', { method: 'DELETE' })
                                                    fetchImportJobs()
                                                }}
                                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                            >
                                                Clear All
                                            </AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                                <Button variant="ghost" size="sm" onClick={fetchImportJobs}>
                                    <RefreshCw className="h-4 w-4 mr-2" />
                                    Refresh
                                </Button>
                            </div>
                        </div>
                        <div className="space-y-2">
                            {importJobs.slice(0, 10).map((job) => (
                                <div
                                    key={job.id}
                                    className="flex items-center gap-4 p-3 rounded-lg bg-secondary/30 border"
                                >
                                    {/* Artwork or placeholder */}
                                    <div className="h-12 w-12 rounded bg-secondary flex items-center justify-center flex-shrink-0 overflow-hidden">
                                        {job.artworkUrl ? (
                                            <img
                                                src={job.artworkUrl}
                                                alt={job.title}
                                                className="h-full w-full object-cover"
                                            />
                                        ) : (
                                            <Music className="h-5 w-5 text-muted-foreground" />
                                        )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        {/* Clickable title if album/playlist was imported */}
                                        {job.status === 'complete' && (job.importedAlbumId || job.importedPlaylistId) ? (
                                            <button
                                                onClick={() => {
                                                    // For playlists, navigate to playlist view
                                                    if (job.type === 'playlist' && job.importedPlaylistId) {
                                                        navigateToPlaylist(job.importedPlaylistId)
                                                        return
                                                    }
                                                    // For albums, find and navigate to album
                                                    for (const artist of library) {
                                                        const album = artist.albums.find(a => a.id === job.importedAlbumId)
                                                        if (album) {
                                                            setSelectedAlbum({
                                                                id: album.id,
                                                                title: album.title,
                                                                artistName: artist.name,
                                                                tracks: album.tracks,
                                                                description: album.description ?? undefined,
                                                                copyright: album.copyright ?? undefined,
                                                                genre: album.genre ?? undefined,
                                                                releaseDate: album.releaseDate ?? undefined,
                                                                recordLabel: album.recordLabel ?? undefined
                                                            })
                                                            return
                                                        }
                                                    }
                                                }}
                                                className="font-medium truncate text-left hover:underline hover:text-primary transition-colors block w-full"
                                            >
                                                {job.title}
                                            </button>
                                        ) : (
                                            <p className="font-medium truncate">{job.title}</p>
                                        )}
                                        <p className="text-xs text-muted-foreground truncate">
                                            {job.artist && <span>{job.artist} • </span>}
                                            {job.type} • {job.tracksComplete}/{job.tracksTotal || '?'} tracks
                                        </p>
                                    </div>
                                    <div className={cn(
                                        "px-2 py-1 rounded text-xs font-medium capitalize",
                                        job.status === 'complete' && "bg-green-500/10 text-green-600",
                                        job.status === 'error' && "bg-red-500/10 text-red-600",
                                        job.status === 'downloading' && "bg-blue-500/10 text-blue-600",
                                        job.status === 'pending' && "bg-yellow-500/10 text-yellow-600"
                                    )}>
                                        {job.status}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Sync Status */}
                <div className="mt-8">
                    <SyncStatus />
                </div>

                {/* Bottom padding for player clearance */}
                <div className="h-24" />
            </div>

            {/* Settings Sheet */}
            <ImportSettings
                open={showSettings}
                onOpenChange={setShowSettings}
                onSettingsUpdate={() => {
                    checkServiceHealth()
                }}
            />
        </div>
    )
}
