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
    Layers,
    Search,
    ChevronLeft
} from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/animate-ui/components/radix/tabs"
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

interface SearchResultItem {
    type: 'song' | 'album'
    apple_music_id: string
    title: string
    artist?: string
    artwork_url?: string
    track_count?: number
    album_name?: string
    duration_ms?: number
}

interface SearchResults {
    songs: SearchResultItem[]
    albums: SearchResultItem[]
    term: string
    storefront: string
}

// Separate component to properly use the hook and avoid hydration errors
function ActiveDownloadsBadge() {
    const downloadStats = usePlayerStore(state => state.downloadStats)

    if (downloadStats.activeDownloads <= 0) return null

    return (
        <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
            {downloadStats.activeDownloads}
        </span>
    )
}

interface ImportViewProps {
    autoFocusUrl?: boolean
    initialUrl?: string
}

export function ImportView({ autoFocusUrl = false, initialUrl }: ImportViewProps) {
    const {
        gamdlServiceOnline,
        setGamdlServiceOnline,
        setLibrary,
        setSelectedAlbum,
        library,
        setPlaylists,
        navigateToPlaylist,
        // Global Queue Actions
        addDownloadItem,
        updateDownloadItem,
        updateDownloadStats
    } = usePlayerStore()

    const urlInputRef = useRef<HTMLInputElement>(null)

    // Auto-focus URL input when navigating from "Import Media..." button
    useEffect(() => {
        if (autoFocusUrl && urlInputRef.current) {
            // Small delay to ensure component is fully mounted
            setTimeout(() => {
                urlInputRef.current?.focus()
            }, 100)
        }
    }, [autoFocusUrl])

    const [url, setUrl] = useState(initialUrl || "")
    const [isValidating, setIsValidating] = useState(false)
    const [validationResult, setValidationResult] = useState<ValidationResult | null>(null)
    const [batchResults, setBatchResults] = useState<ValidationResult[]>([])
    const [isDownloading, setIsDownloading] = useState(false)

    const [isSuccess, setIsSuccess] = useState(false) // For success tick animation
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

    // Search state
    const [searchResults, setSearchResults] = useState<SearchResults | null>(null)
    const [isSearching, setIsSearching] = useState(false)
    const [selectedSearchItem, setSelectedSearchItem] = useState<SearchResultItem | null>(null)

    // Ref to track currentJobId for WebSocket handler (avoids stale closure)
    const jobIdRef = useRef<string | null>(null)

    // Detect if input is a URL or search query
    const isAppleMusicUrl = useCallback((input: string) => {
        return input.includes('music.apple.com')
    }, [])

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
        setSearchResults(null)
        setSelectedSearchItem(null)

        if (!url || url.length < 10) {
            return
        }

        // Only auto-validate if it looks like an Apple Music URL
        // For search queries, user must press Enter or click Search button
        if (!isAppleMusicUrl(url)) {
            return
        }

        // Debounce validation for URLs only
        const timeout = setTimeout(async () => {
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
                        } else if (item.type === 'album' || item.type === 'playlist') {
                            // For albums/playlists, use default codecs from settings
                            // Availability is checked per-track during download
                            setSelectedCodecs(defaultCodecs.length > 0 ? [...defaultCodecs] : ['aac-legacy'])
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
    }, [url, isAppleMusicUrl])

    // WebSocket handler to replace SSE
    // WebSocket handler to replace SSE
    useEffect(() => {
        // Always connect to WS to receive updates even if not initiated from this tab (persistence)
        // unless we want to save bandwidth. But requirements say "Live updates for track counts".
        // So we should connect always or when jobs are active.

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

                    // Update global queue item if it exists
                    // We need the job ID / track ID linkage. 
                    // The WS events for 'track_starting' are generic.
                    // 'download_started' event is handled globally in player.tsx
                }
                // Note: download_started is handled globally in player.tsx to avoid duplicates
                else if (type === 'download_codec_started') {
                    // Initialize codec status
                    updateDownloadItem(data.track_id, {
                        codecStatus: {
                            // We need to merge with existing state, but zustand updates are shallow merges?
                            // No, our reducer does spread on item, but we need to pass the FULL nested object or handle deep merge manually in the component
                            // Easier: Let's assume the store helper does a shallow merge of the item properties.
                            // So for nested objects like codecStatus, we need to read previous state? 
                            // We can't easily access previous item state here without `usePlayerStore.getState()`.

                            // Actually, let's use the functional update pattern if possible, or just read from store:
                            // usePlayerStore.getState().downloadQueue...
                        }
                    })

                    // Since we can't do functional update on specific item easily via the exposed action (which takes values),
                    // We'll trust that we can just update the specific fields.
                    // But wait, `updateDownloadItem` does `{ ...item, ...updates }`.
                    // So if we pass `codecStatus`, it replaces the WHOLE codecStatus object.

                    const queue = usePlayerStore.getState().downloadQueue
                    const item = queue.find(i => i.id === data.track_id)
                    if (item) {
                        updateDownloadItem(data.track_id, {
                            codecStatus: { ...item.codecStatus, [data.codec]: 'downloading' },
                            codecProgress: { ...item.codecProgress, [data.codec]: 0 }
                        })
                    }
                }
                else if (type === 'download_progress') {
                    const queue = usePlayerStore.getState().downloadQueue
                    const item = queue.find(i => i.id === data.track_id)
                    if (item) {
                        const updates: Partial<{ progress: number; codecStatus: Record<string, 'pending' | 'downloading' | 'completed' | 'failed' | 'decrypting'>; codecProgress: Record<string, number> }> = {
                            progress: data.progress_pct
                        }

                        if (data.codec) {
                            updates.codecStatus = { ...item.codecStatus, [data.codec]: 'downloading' }
                            updates.codecProgress = { ...item.codecProgress, [data.codec]: data.progress_pct }
                        }

                        updateDownloadItem(data.track_id, updates)
                    }
                }
                else if (type === 'download_codec_complete') {
                    const queue = usePlayerStore.getState().downloadQueue
                    const item = queue.find(i => i.id === data.track_id)
                    if (item) {
                        updateDownloadItem(data.track_id, {
                            codecStatus: { ...item.codecStatus, [data.codec]: data.success ? 'completed' : 'failed' },
                            codecProgress: { ...item.codecProgress, [data.codec]: 100 }
                        })
                    }
                }
                else if (type === 'download_complete') {
                    const queue = usePlayerStore.getState().downloadQueue
                    const item = queue.find(i => i.id === data.metadata?.appleMusicId) // ID mismatch possible?
                    // gamdl returns IDs. Let's hope track_id in events matches.
                    // 'download_complete' data uses 'metadata.appleMusicId' usually?
                    // The 'download_started' used 'track_id'.
                    // We should verify strict ID usage.

                    // Mark as complete in global queue
                    // Actually, let's look up by track_id if available, or fallback.
                    // We might not have track_id in download_complete event data from python?
                    // Let's assume we do or can infer it.

                    // Also update Import Jobs list for valid live counts
                    setImportJobs(prev => prev.map(job => {
                        if (job.id === jobIdRef.current) {
                            return { ...job, tracksComplete: data.current }
                        }
                        return job
                    }))

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

                        if (data.current === data.total) {
                            // Show toast only when entire import job is complete
                            const jobTitle = validationResult?.title || data.metadata?.album || data.metadata?.title || 'Import'
                            toast.success(`${jobTitle} imported successfully!`, {
                                description: `Added to library.`,
                            })

                            setIsDownloading(false)
                            setValidationResult(null)
                            setUrl('')
                            fetchImportJobs()
                            refreshLibrary()
                            refreshPlaylists()

                            // Remove from global queue? Or keep as history?
                            // Plan says "retains history". So keep it.
                            // Maybe mark item as 'completed'
                            // We need to know which item it was.
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

    }, []) // Run once on mount to persistent connection

    // Handle search - triggered by Enter or button click
    const handleSearch = useCallback(async () => {
        if (!url || url.length < 2 || isAppleMusicUrl(url)) return

        setIsSearching(true)
        setSearchResults(null)
        setSelectedSearchItem(null)
        setValidationResult(null)
        setBatchResults([])

        try {
            const res = await fetch('/api/import/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ term: url })
            })

            if (!res.ok) {
                const error = await res.json()
                toast.error('Search failed', { description: error.error })
                return
            }

            const results: SearchResults = await res.json()
            setSearchResults(results)

        } catch (err) {
            console.error('Search error:', err)
            toast.error('Search failed')
        } finally {
            setIsSearching(false)
        }
    }, [url, isAppleMusicUrl])

    // Handle search result click - validate to get codec info
    const handleSearchResultClick = useCallback(async (item: SearchResultItem) => {
        setSelectedSearchItem(item)
        setIsValidating(true)

        try {
            // Build URL for validation using the storefront from search results
            // Note: URL parser expects a slug between type and ID, so we add a placeholder '_'
            const storefront = searchResults?.storefront || 'us'
            const itemUrl = item.type === 'song'
                ? `https://music.apple.com/${storefront}/song/_/${item.apple_music_id}`
                : `https://music.apple.com/${storefront}/album/_/${item.apple_music_id}`

            // Use existing validation endpoint to get codec info
            const res = await fetch('/api/import/validate-batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: itemUrl })
            })

            if (!res.ok) {
                throw new Error(`Validation failed: ${res.status}`)
            }

            const result = await res.json()

            if (result.items && result.items.length > 0) {
                const validatedItem = result.items[0]
                setValidationResult(validatedItem)

                // Initialize codec selection (same logic as existing URL validation)
                if (validatedItem.type === 'song' && validatedItem.available_codecs?.length) {
                    const available = new Set(validatedItem.available_codecs)
                    const downloaded = new Set(validatedItem.downloaded_codecs || [])
                    const initialSelection = defaultCodecs.filter(c => available.has(c) && !downloaded.has(c))

                    if (initialSelection.length > 0) {
                        setSelectedCodecs(initialSelection)
                    } else {
                        const firstNotDownloaded = validatedItem.available_codecs.find((c: string) => !downloaded.has(c))
                        setSelectedCodecs(firstNotDownloaded ? [firstNotDownloaded] : [])
                    }
                } else if (validatedItem.type === 'album') {
                    setSelectedCodecs(defaultCodecs.length > 0 ? [...defaultCodecs] : ['aac-legacy'])
                }
            } else {
                // No items returned - show error and go back to search results
                toast.error('Could not fetch track details', { description: 'The content may not be available in your region' })
                setSelectedSearchItem(null)
            }
        } catch (err) {
            console.error('Validation error:', err)
            toast.error('Failed to get track details')
            setSelectedSearchItem(null)
        } finally {
            setIsValidating(false)
        }
    }, [defaultCodecs, searchResults])

    // Clear search results when going back
    const handleBackFromPreview = useCallback(() => {
        setSelectedSearchItem(null)
        setValidationResult(null)
        setSelectedCodecs([])
    }, [])

    // Format duration helper
    const formatDuration = (ms: number): string => {
        if (!ms) return "0:00"
        const seconds = Math.floor(ms / 1000)
        const m = Math.floor(seconds / 60)
        const s = seconds % 60
        return `${m}:${s.toString().padStart(2, '0')}`
    }

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
                    // Pass selected codecs for all types (songs, albums, playlists)
                    // For albums/playlists, availability is checked per-track during download
                    selectedCodecs: selectedCodecs.length > 0
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

            // Immediate success feedback
            setIsSuccess(true)

            // Optimistically add to jobs list
            setImportJobs(prev => [{
                id: jobId,
                url: downloadUrl,
                type: validationResult.type,
                title: validationResult.title,
                artist: validationResult.artist,
                artworkUrl: validationResult.artwork_url,
                status: 'pending', // or 'running'
                progress: 0,
                tracksTotal: validationResult.track_count || 1,
                tracksComplete: 0,
                createdAt: new Date().toISOString()
            }, ...prev])

            setTimeout(() => {
                setIsSuccess(false)
                // We keep isDownloading true until complete? 
                // Actually the button should probably revert to allow more downloads if it's a batch?
                // But for now, let's just complete the tick animation.

                // If we want to allow user to navigate away or download more, 
                // we shouldn't block UI with isDownloading.
                // But existing logic uses it to show progress on the button.
            }, 3000)

        } catch (err: unknown) {
            console.error('Download error:', err)
            setIsDownloading(false)
            toast.error(err instanceof Error ? err.message : 'Failed to start download')
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
                        className="relative"
                        onClick={() => setShowQueue(true)}
                        title="Download Queue"
                    >
                        <Download className="h-4 w-4" />
                        {/* Badge for active downloads - using hook from component context */}
                        <ActiveDownloadsBadge />
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
                        <label className="text-sm font-medium">Apple Music URL or Search</label>
                        <div className="relative">
                            {isAppleMusicUrl(url) ? (
                                <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            ) : (
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            )}
                            <Input
                                ref={urlInputRef}
                                placeholder="Paste Apple Music URL or search by name..."
                                value={url}
                                onChange={(e) => setUrl(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && url && !isAppleMusicUrl(url)) {
                                        e.preventDefault()
                                        handleSearch()
                                    }
                                }}
                                className="pl-10 pr-16"
                                disabled={isDownloading}
                            />
                            {/* Search button - show when input is not a URL */}
                            {!isAppleMusicUrl(url) && url.length >= 2 && (
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    className="absolute right-1 top-1/2 -translate-y-1/2 h-7 px-2"
                                    onClick={handleSearch}
                                    disabled={isSearching || isDownloading}
                                >
                                    {isSearching ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                        <Search className="h-4 w-4" />
                                    )}
                                </Button>
                            )}
                            {/* Status icons for URL validation */}
                            {isAppleMusicUrl(url) && isValidating && (
                                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
                            )}
                            {isAppleMusicUrl(url) && !isValidating && (validationResult || batchResults.length > 0) && (
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

                    {/* Search Results - Show when we have search results and no selected item */}
                    {searchResults && !selectedSearchItem && !validationResult && (
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <p className="text-sm font-medium text-muted-foreground">
                                    Results for &quot;{searchResults.term}&quot;
                                </p>
                            </div>

                            <Tabs defaultValue="albums" className="w-full">
                                <TabsList className="grid w-full grid-cols-2">
                                    <TabsTrigger value="albums">
                                        Albums ({searchResults.albums.length})
                                    </TabsTrigger>
                                    <TabsTrigger value="songs">
                                        Songs ({searchResults.songs.length})
                                    </TabsTrigger>
                                </TabsList>

                                <TabsContent value="albums" className="mt-4">
                                    {searchResults.albums.length === 0 ? (
                                        <p className="text-sm text-muted-foreground text-center py-4">
                                            No albums found
                                        </p>
                                    ) : (
                                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 max-h-80 overflow-y-auto">
                                            {searchResults.albums.map((album) => (
                                                <button
                                                    key={album.apple_music_id}
                                                    onClick={() => handleSearchResultClick(album)}
                                                    className="flex flex-col items-center gap-2 p-3 rounded-lg bg-secondary/30 hover:bg-secondary/50 transition-colors text-left"
                                                >
                                                    <div className="h-24 w-24 rounded-md bg-secondary flex items-center justify-center overflow-hidden">
                                                        {album.artwork_url ? (
                                                            <img
                                                                src={album.artwork_url}
                                                                alt={album.title}
                                                                className="h-full w-full object-cover"
                                                            />
                                                        ) : (
                                                            <Music className="h-8 w-8 text-muted-foreground" />
                                                        )}
                                                    </div>
                                                    <div className="w-full text-center">
                                                        <p className="font-medium text-sm truncate">{album.title}</p>
                                                        <p className="text-xs text-muted-foreground truncate">
                                                            {album.artist}
                                                        </p>
                                                        {album.track_count && (
                                                            <p className="text-xs text-muted-foreground">
                                                                {album.track_count} tracks
                                                            </p>
                                                        )}
                                                    </div>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </TabsContent>

                                <TabsContent value="songs" className="mt-4">
                                    {searchResults.songs.length === 0 ? (
                                        <p className="text-sm text-muted-foreground text-center py-4">
                                            No songs found
                                        </p>
                                    ) : (
                                        <div className="space-y-2 max-h-80 overflow-y-auto">
                                            {searchResults.songs.map((song) => (
                                                <button
                                                    key={song.apple_music_id}
                                                    onClick={() => handleSearchResultClick(song)}
                                                    className="w-full flex items-center gap-3 p-2 rounded-md bg-secondary/30 hover:bg-secondary/50 transition-colors text-left"
                                                >
                                                    <div className="h-12 w-12 rounded bg-secondary flex items-center justify-center overflow-hidden flex-shrink-0">
                                                        {song.artwork_url ? (
                                                            <img
                                                                src={song.artwork_url}
                                                                alt={song.title}
                                                                className="h-full w-full object-cover"
                                                            />
                                                        ) : (
                                                            <Music className="h-5 w-5 text-muted-foreground" />
                                                        )}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <p className="font-medium text-sm truncate">{song.title}</p>
                                                        <p className="text-xs text-muted-foreground truncate">
                                                            {song.artist}
                                                            {song.album_name && ` • ${song.album_name}`}
                                                        </p>
                                                    </div>
                                                    {song.duration_ms && (
                                                        <span className="text-xs text-muted-foreground">
                                                            {formatDuration(song.duration_ms)}
                                                        </span>
                                                    )}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </TabsContent>
                            </Tabs>
                        </div>
                    )}

                    {/* Search Result Loading - Show when validating selected item */}
                    {selectedSearchItem && isValidating && (
                        <div className="p-4 rounded-lg bg-secondary/30 border">
                            <div className="flex items-center gap-4">
                                <div className="h-16 w-16 rounded-md bg-secondary animate-pulse" />
                                <div className="flex-1 space-y-2">
                                    <div className="h-4 w-3/4 bg-secondary rounded animate-pulse" />
                                    <div className="h-3 w-1/2 bg-secondary rounded animate-pulse" />
                                </div>
                            </div>
                            <p className="text-sm text-muted-foreground mt-3 text-center">
                                Loading codec availability...
                            </p>
                        </div>
                    )}

                    {/* Back button when viewing search result preview */}
                    {selectedSearchItem && validationResult?.valid && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleBackFromPreview}
                            className="mb-2"
                        >
                            <ChevronLeft className="h-4 w-4 mr-1" />
                            Back to search results
                        </Button>
                    )}

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
                                                'aac-he-downmix': { label: 'HE Downmix', category: 'standard' },
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

                            {/* Codec Selection for Albums & Playlists - show ALL possible codecs */}
                            {(validationResult.type === 'album' || validationResult.type === 'playlist') && (
                                <div className="space-y-2">
                                    <p className="text-xs font-medium text-muted-foreground">
                                        Select formats to download:
                                        <span className="text-[10px] ml-1 opacity-70">(availability checked per track)</span>
                                    </p>
                                    <div className="flex flex-wrap gap-2">
                                        {(() => {
                                            const allCodecs = [
                                                'aac-legacy',
                                                'aac-he-legacy',
                                                'aac',
                                                'aac-he',
                                                'alac',
                                                'atmos',
                                                'aac-binaural',
                                                'aac-he-binaural',
                                                'aac-downmix',
                                                'aac-he-downmix',
                                                'ac3',
                                            ]
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
                                                'aac-he-downmix': { label: 'HE Downmix', category: 'standard' },
                                                'ac3': { label: 'AC3', category: 'spatial' },
                                            }

                                            return allCodecs.map((codec) => {
                                                const isSelected = selectedCodecs.includes(codec)
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
                                                        {isSelected && <span className="ml-1">✓</span>}
                                                    </button>
                                                )
                                            })
                                        })()}
                                    </div>
                                    <p className="text-[10px] text-muted-foreground">
                                        {selectedCodecs.length} format{selectedCodecs.length !== 1 ? 's' : ''} selected
                                        {selectedCodecs.length > 0 && ' • Unavailable formats will be skipped per track'}
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
                        className={cn(
                            "w-full transition-all duration-300",
                            isSuccess && "bg-green-500 hover:bg-green-600 text-white"
                        )}
                        disabled={
                            (!validationResult?.valid && batchResults.length === 0) ||
                            isDownloading ||
                            !gamdlServiceOnline ||
                            !cookiesConfigured ||
                            (validationResult?.valid && selectedCodecs.length === 0)
                        }
                        onClick={batchResults.length > 0 ? handleBatchDownload : handleDownload}
                    >
                        {isSuccess ? (
                            <>
                                <CheckCircle2 className="h-5 w-5 mr-2 animate-in zoom-in spin-in-90 duration-300" />
                                Started!
                            </>
                        ) : isDownloading ? (
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
                                                        window.location.href = `/playlist/${job.importedPlaylistId}`
                                                        return
                                                    }
                                                    // For albums and songs, navigate to album
                                                    if (job.importedAlbumId) {
                                                        window.location.href = `/album/${job.importedAlbumId}`
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
