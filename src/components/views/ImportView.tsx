"use client"

import * as React from "react"
import { useState, useEffect, useCallback, useRef } from "react"
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
    Trash2,
    Layers
} from "lucide-react"
import { cn } from "@/lib/utils"
import { ImportSettings } from "./ImportSettings"
import { SyncStatus } from "./SyncStatus"
import { DownloadQueue } from "./DownloadQueue"
import { WrapperLoginModal } from "@/components/WrapperLoginModal"
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
    available_codecs?: string[]  // Available codecs for songs (from API)
    downloaded_codecs?: string[] // Already downloaded codecs for this track
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
    const [currentJobId, setCurrentJobId] = useState<string | null>(null)
    const [importJobs, setImportJobs] = useState<ImportJob[]>([])
    const [showSettings, setShowSettings] = useState(false)
    const [showQueue, setShowQueue] = useState(false)
    const [cookiesConfigured, setCookiesConfigured] = useState(false)
    const [showWrapperLogin, setShowWrapperLogin] = useState(false)
    const [wrapperNeedsAuth, setWrapperNeedsAuth] = useState(false)

    // Codec selection state for songs
    const [selectedCodecs, setSelectedCodecs] = useState<string[]>([])
    const [defaultCodecs, setDefaultCodecs] = useState<string[]>(['aac-legacy'])

    // Ref to track currentJobId for WebSocket handler (avoids stale closure)
    const jobIdRef = useRef<string | null>(null)

    // Check service health on mount
    const checkServiceHealth = useCallback(async () => {
        try {
            const res = await fetch('/api/import/settings')
            if (res.ok) {
                const data = await res.json()
                setGamdlServiceOnline(data.serviceOnline)
                setCookiesConfigured(data.cookiesConfigured)
                // Get default codecs from settings
                if (data.songCodecs) {
                    const codecs = data.songCodecs.split(',').filter((c: string) => c.trim())
                    setDefaultCodecs(codecs.length > 0 ? codecs : ['aac-legacy'])
                }
            }
        } catch {
            setGamdlServiceOnline(false)
        }
    }, [setGamdlServiceOnline])

    useEffect(() => {
        checkServiceHealth()
        // Fetch existing import jobs
        fetchImportJobs()
        // Check wrapper status
        checkWrapperStatus()
    }, [checkServiceHealth])

    const checkWrapperStatus = async () => {
        try {
            // Use Next.js API proxy instead of direct Python call
            const res = await fetch('/api/wrapper/status')
            if (res.ok) {
                const data = await res.json()
                setWrapperNeedsAuth(data.needs_auth && data.is_running)
            }
        } catch {
            // Ignore - wrapper check is optional
        }
    }

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
                        const item = result.items[0]
                        setValidationResult(item)
                        setBatchResults([])

                        // Initialize selected codecs for songs based on availability and defaults
                        if (item.type === 'song' && item.available_codecs?.length) {
                            // Filter defaultCodecs to only those available AND not already downloaded
                            const available = new Set(item.available_codecs)
                            const downloaded = new Set(item.downloaded_codecs || [])

                            // Select defaults that are available but NOT already downloaded
                            const initialSelection = defaultCodecs.filter(c => available.has(c) && !downloaded.has(c))

                            if (initialSelection.length > 0) {
                                setSelectedCodecs(initialSelection)
                            } else {
                                // All defaults are downloaded - try first available that's not downloaded
                                const firstNotDownloaded = item.available_codecs.find((c: string) => !downloaded.has(c))
                                setSelectedCodecs(firstNotDownloaded ? [firstNotDownloaded] : [])
                            }
                        } else {
                            setSelectedCodecs([])
                        }
                    } else {
                        // Multiple URLs - show batch UI
                        setValidationResult(null)
                        setBatchResults(result.items)
                        setSelectedCodecs([])
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

    // WebSocket handler to replace SSE
    useEffect(() => {
        if (!isDownloading) return

        // Connect to Next.js WebSocket proxy (not directly to Python)
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
        const ws = new WebSocket(`${wsProtocol}//${window.location.host}/ws`)

        ws.onopen = () => {
            console.log('Connected to Import WebSocket')
        }

        ws.onmessage = async (event) => {
            try {
                const message = JSON.parse(event.data)
                const type = message.type
                const data = message.data || {}

                // Debug: log download_complete to trace metadata
                if (type === 'download_complete') {
                    console.log('[ImportView] download_complete received:', { type, data, metadata: data.metadata })
                }

                if (type === 'track_starting') {
                    // data: { current, total, percent }
                    setDownloadProgress({ current: data.current, total: data.total })
                }
                else if (type === 'download_complete') {
                    // Track completed - insert into library via API
                    try {
                        const completeBody = {
                            filePath: data.file_path,
                            codecPaths: data.codec_paths,
                            lyricsPath: data.lyrics_path,
                            coverPath: data.cover_path,
                            metadata: data.metadata,
                            current: data.current,
                            total: data.total,
                            jobId: jobIdRef.current // Use ref to get latest jobId
                        }

                        const res = await fetch('/api/import/complete', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(completeBody)
                        })

                        if (!res.ok) {
                            console.error('Failed to save track to DB')
                        }

                        // Update progress
                        setDownloadProgress({ current: data.current, total: data.total })

                        // Show toast - prefer metadata.title over top-level title
                        const trackTitle = data.metadata?.title || data.title || 'Track'
                        toast.success(`${trackTitle} imported successfully!`, {
                            description: `Added to library.`,
                        })

                        if (data.current === data.total) {
                            setIsDownloading(false)
                            setValidationResult(null)
                            setUrl('')
                            fetchImportJobs()
                            refreshLibrary()
                            refreshPlaylists()
                        }

                    } catch (dbErr) {
                        console.error('Error saving imported track:', dbErr)
                    }
                }
                else if (type === 'download_failed') {
                    console.error('Download failed:', data.error)
                    toast.error('Download Failed', {
                        description: data.error
                    })
                    setIsDownloading(false)
                }

            } catch (parseErr) {
                console.error('WS Parse Error:', parseErr)
            }
        }

        ws.onerror = (err) => {
            console.error('WebSocket Error:', err)
        }

        return () => {
            ws.close()
        }
    }, [isDownloading])

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
                    globalId: validationResult.global_id,
                    // Pass selected codecs for songs (overrides settings)
                    selectedCodecs: validationResult.type === 'song' && selectedCodecs.length > 0
                        ? selectedCodecs
                        : undefined
                })
            })

            if (!startRes.ok) {
                const error = await startRes.json()
                throw new Error(error.error || 'Failed to start download')
            }

            const { jobId } = await startRes.json()

            // WebSocket connection is handled by the useEffect hook above.
            // We just rely on the background job started by /api/import/start
            console.log('Download started, job:', jobId)
            setCurrentJobId(jobId)
            jobIdRef.current = jobId // Store in ref for WebSocket handler

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
                    {/* Wrapper auth button */}
                    {wrapperNeedsAuth && (
                        <Button
                            variant="outline"
                            size="sm"
                            className="text-amber-600 border-amber-600 hover:bg-amber-50"
                            onClick={() => setShowWrapperLogin(true)}
                        >
                            Login to Apple Music
                        </Button>
                    )}
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
                        onClick={() => setShowQueue(true)}
                        title="Download Queue"
                    >
                        <Layers className="h-4 w-4" />
                    </Button>
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
                        <div className="p-4 rounded-lg bg-secondary/30 border space-y-3">
                            <div className="flex items-center gap-4">
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

                            {/* Codec Selection for Songs */}
                            {validationResult.type === 'song' && validationResult.available_codecs && validationResult.available_codecs.length > 0 && (
                                <div className="space-y-2">
                                    <p className="text-xs font-medium text-muted-foreground">Select formats to download:</p>
                                    <div className="flex flex-wrap gap-2">
                                        {validationResult.available_codecs.map((codec) => {
                                            const isSelected = selectedCodecs.includes(codec)
                                            const isDownloaded = validationResult.downloaded_codecs?.includes(codec)
                                            const codecLabels: Record<string, { label: string; category: 'standard' | 'hires' | 'spatial' }> = {
                                                'aac-legacy': { label: 'AAC', category: 'standard' },
                                                'aac-he-legacy': { label: 'AAC-HE', category: 'standard' },
                                                'aac': { label: 'AAC 48kHz', category: 'standard' },
                                                'aac-he': { label: 'AAC-HE 48kHz', category: 'standard' },
                                                'alac': { label: 'Lossless', category: 'hires' },
                                                'atmos': { label: 'Dolby Atmos', category: 'spatial' },
                                                'aac-binaural': { label: 'Spatial', category: 'spatial' },
                                                'aac-he-binaural': { label: 'Spatial HE', category: 'spatial' },
                                                'aac-downmix': { label: 'Downmix', category: 'standard' },
                                                'ac3': { label: 'AC3', category: 'spatial' },
                                            }
                                            const info = codecLabels[codec] || { label: codec.toUpperCase(), category: 'standard' as const }

                                            return (
                                                <button
                                                    key={codec}
                                                    type="button"
                                                    onClick={() => {
                                                        if (isSelected) {
                                                            setSelectedCodecs(selectedCodecs.filter(c => c !== codec))
                                                        } else {
                                                            setSelectedCodecs([...selectedCodecs, codec])
                                                        }
                                                    }}
                                                    className={cn(
                                                        "px-3 py-1 rounded-full text-xs font-medium transition-all flex items-center gap-1",
                                                        "border-2",
                                                        isDownloaded
                                                            ? "border-green-500 bg-green-500/20 text-green-600 dark:text-green-300"
                                                            : isSelected
                                                                ? info.category === 'hires'
                                                                    ? "border-purple-500 bg-purple-500/20 text-purple-600 dark:text-purple-300"
                                                                    : info.category === 'spatial'
                                                                        ? "border-blue-500 bg-blue-500/20 text-blue-600 dark:text-blue-300"
                                                                        : "border-primary bg-primary/20 text-primary"
                                                                : "border-transparent bg-muted/50 text-muted-foreground hover:bg-muted"
                                                    )}
                                                >
                                                    {isDownloaded && (
                                                        <CheckCircle2 className="h-3 w-3" />
                                                    )}
                                                    {info.label}
                                                    {isSelected && !isDownloaded && <span className="ml-1">✓</span>}
                                                </button>
                                            )
                                        })}
                                    </div>
                                    <p className="text-[10px] text-muted-foreground">
                                        {selectedCodecs.length} format{selectedCodecs.length !== 1 ? 's' : ''} selected
                                    </p>
                                </div>
                            )}
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
                            !cookiesConfigured ||
                            (validationResult?.valid && selectedCodecs.length === 0)
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

            {/* Download Queue Modal */}
            <DownloadQueue
                open={showQueue}
                onClose={() => setShowQueue(false)}
            />

            {/* Wrapper Login Modal */}
            <WrapperLoginModal
                open={showWrapperLogin}
                onOpenChange={setShowWrapperLogin}
                onAuthSuccess={() => {
                    setWrapperNeedsAuth(false)
                    toast.success("Wrapper authenticated! ALAC/Atmos downloads enabled.")
                }}
            />
        </div >
    )
}
