"use client"

import * as React from "react"
import { usePlayerStore, DownloadItem } from "@/lib/store"

/**
 * DownloadManager - Handles global WebSocket connection for download progress tracking.
 * This component should be mounted once in the app layout.
 * It manages the download queue state via Zustand store.
 */
export function DownloadManager() {
    const {
        addDownloadItem,
        updateDownloadItem,
    } = usePlayerStore()

    React.useEffect(() => {
        // Skip on server-side rendering
        if (typeof window === 'undefined') return

        // Connect to Next.js WebSocket proxy
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
        const ws = new WebSocket(`${wsProtocol}//${window.location.host}/ws`)

        ws.onopen = () => {
            console.log('[DownloadManager] Connected to WebSocket')
        }

        ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data)
                const type = message.type
                const data = message.data || {}

                if (type === 'download_started') {
                    const queue = usePlayerStore.getState().downloadQueue

                    // Check if there's already a downloading entry for this track
                    const existingItem = queue.find(i => i.trackId === data.track_id && i.status === 'downloading')

                    if (existingItem) {
                        // Already tracking this track - skip duplicate
                        console.log(`[DownloadManager] download_started: Item already exists for ${data.track_id}, skipping duplicate`)
                        return
                    }

                    // Generate unique ID for this download session
                    const uniqueId = `${data.track_id}-${Date.now()}`

                    // Initialize codec status for all expected codecs
                    const codecStatus: Record<string, 'pending' | 'downloading' | 'decrypting' | 'completed' | 'failed'> = {}
                    const codecProgress: Record<string, number> = {}
                    const codecTotalBytes: Record<string, number> = {}
                    const codecLoadedBytes: Record<string, number> = {}
                    const codecSpeed: Record<string, number> = {}

                    if (data.codecs && Array.isArray(data.codecs)) {
                        data.codecs.forEach((c: string) => {
                            codecStatus[c] = 'pending'
                            codecProgress[c] = 0
                            codecTotalBytes[c] = 0
                            codecLoadedBytes[c] = 0
                            codecSpeed[c] = 0
                        })
                    }

                    addDownloadItem({
                        id: uniqueId,
                        trackId: data.track_id,
                        title: data.title,
                        artist: data.artist,
                        album: data.album,
                        status: 'downloading',
                        progress: 0,
                        totalTracks: data.total,
                        completedTracks: data.current - 1,
                        addedAt: Date.now(),
                        codecStatus,
                        codecProgress,
                        codecTotalBytes,
                        codecLoadedBytes,
                        codecSpeed,
                        loadedBytes: 0,
                        totalBytes: 0,
                        speed: 0,
                        eta: 0,
                        downloadedCodecs: []
                    })
                }
                else if (type === 'download_progress') {
                    const queue = usePlayerStore.getState().downloadQueue
                    // Find the most recent downloading item for this track
                    const item = queue.find(i => i.trackId === data.track_id && i.status === 'downloading')
                    if (item) {
                        const updates: Partial<DownloadItem> = {}
                        // Ensure all codecs are initialized if provided in progress event (for late joiners)
                        if (data.codecs && Array.isArray(data.codecs)) {
                            const updatedCodecStatus = { ...item.codecStatus }
                            const updatedCodecProgress = { ...item.codecProgress }
                            const updatedCodecTotalBytes = { ...item.codecTotalBytes }
                            const updatedCodecLoadedBytes = { ...item.codecLoadedBytes }
                            const updatedCodecSpeed = { ...item.codecSpeed }
                            let stateChanged = false

                            data.codecs.forEach((c: string) => {
                                if (!updatedCodecStatus[c]) {
                                    updatedCodecStatus[c] = 'pending'
                                    updatedCodecProgress[c] = 0
                                    updatedCodecTotalBytes[c] = 0
                                    updatedCodecLoadedBytes[c] = 0
                                    updatedCodecSpeed[c] = 0
                                    stateChanged = true
                                }
                            })

                            if (stateChanged) {
                                updates.codecStatus = updatedCodecStatus
                                updates.codecProgress = updatedCodecProgress
                                updates.codecTotalBytes = updatedCodecTotalBytes
                                updates.codecLoadedBytes = updatedCodecLoadedBytes
                                updates.codecSpeed = updatedCodecSpeed
                            }
                        }

                        // Update Codec Stats - only send delta, store will deep-merge
                        if (data.codec) {
                            // Determine if this is download or decrypt stage
                            const isDecryptStage = data.stage === 'decrypt'

                            // Send only the delta for this codec - store handles merging
                            // Use 'decrypting' status for decrypt phase so UI can show different indicator
                            updates.codecStatus = { [data.codec]: isDecryptStage ? 'decrypting' : 'downloading' }

                            if (isDecryptStage) {
                                // During decrypt, update progress normally (bar goes 0-100 during decrypt)
                                updates.codecProgress = { [data.codec]: data.progress_pct }
                                // Don't update bytes during decrypt (already counted during download)
                            } else {
                                // During download, update progress and bytes
                                updates.codecProgress = { [data.codec]: data.progress_pct }

                                // Only update bytes during 'download' stage, not 'decrypt'
                                const newTotal = data.total_bytes || 0
                                updates.codecLoadedBytes = { [data.codec]: data.bytes || 0 }
                                updates.codecSpeed = { [data.codec]: data.speed || 0 }

                                // Only update total_bytes if we have a non-zero value
                                if (newTotal > 0) {
                                    updates.codecTotalBytes = { [data.codec]: newTotal }
                                }
                            }

                            // Note: We don't calculate aggregates here anymore
                            // because we don't have reliable access to other codecs' data
                            // The UI will calculate these from the merged state
                        } else {
                            // Legacy/Native handling fallback
                            updates.progress = data.progress_pct
                        }

                        updateDownloadItem(item.id, updates)

                        // Update Global Stats
                        const allItems = usePlayerStore.getState().downloadQueue
                        const currentGlobalSpeed = allItems.reduce((acc, i) => {
                            if (i.id === item.id) return acc + (updates.speed || 0)
                            return acc + (i.speed || 0)
                        }, 0)

                        const totalQueueSize = allItems.reduce((acc, i) => {
                            if (i.id === item.id) return acc + (updates.totalBytes || 0)
                            return acc + (i.totalBytes || 0)
                        }, 0)

                        usePlayerStore.getState().updateDownloadStats({ currentSpeed: currentGlobalSpeed, totalQueueSize })
                    }
                }
                else if (type === 'download_codec_started') {
                    const item = usePlayerStore.getState().downloadQueue.find(i => i.trackId === data.track_id && i.status === 'downloading')
                    if (item && data.codec) {
                        const updates: Partial<DownloadItem> = {}
                        updates.codecStatus = { ...item.codecStatus, [data.codec]: 'downloading' }
                        updateDownloadItem(item.id, updates)
                    }
                }
                else if (type === 'download_codec_complete') {
                    const item = usePlayerStore.getState().downloadQueue.find(i => i.trackId === data.track_id && i.status === 'downloading')
                    if (item && data.codec) {
                        const updates: Partial<DownloadItem> = {}
                        updates.codecStatus = { ...item.codecStatus, [data.codec]: data.success ? 'completed' : 'failed' }
                        updates.codecProgress = { ...item.codecProgress, [data.codec]: 100 }

                        // Clear speed for this codec
                        const newCodecSpeed = { ...(item.codecSpeed || {}), [data.codec]: 0 }
                        updates.codecSpeed = newCodecSpeed

                        // Re-sum speed
                        const totalSpeed = (Object.values(newCodecSpeed) as number[]).reduce((a: number, b: number) => a + b, 0)
                        updates.speed = totalSpeed

                        updateDownloadItem(item.id, updates)

                        // Update global speed immediately to reflect 0 for this codec
                        const allItems = usePlayerStore.getState().downloadQueue
                        const currentGlobalSpeed = allItems.reduce((acc, i) => {
                            if (i.id === item.id) return acc + totalSpeed
                            return acc + (i.speed || 0)
                        }, 0)
                        usePlayerStore.getState().updateDownloadStats({ currentSpeed: currentGlobalSpeed })
                    }
                }
                else if (type === 'download_complete') {
                    const item = usePlayerStore.getState().downloadQueue.find(i => i.trackId === data.track_id && i.status === 'downloading')
                    if (item) {
                        // Calculate total file size from all codec sizes
                        const finalFileSize = Object.values(item.codecTotalBytes || {}).reduce((a: number, b: number) => a + b, 0)

                        // Mark all codecs as complete and collect downloaded codecs
                        const finalCodecStatus = { ...item.codecStatus }
                        const downloadedCodecs: string[] = []
                        Object.keys(finalCodecStatus).forEach(k => {
                            if (finalCodecStatus[k] === 'downloading') finalCodecStatus[k] = 'completed'
                            if (finalCodecStatus[k] === 'completed') downloadedCodecs.push(k)
                        })

                        updateDownloadItem(item.id, {
                            status: 'completed',
                            progress: 100,
                            speed: 0,
                            eta: 0,
                            fileSize: finalFileSize,
                            codecStatus: finalCodecStatus,
                            downloadedCodecs
                        })

                        // Recalculate global speed - set to 0 if no active downloads
                        setTimeout(() => {
                            const allItems = usePlayerStore.getState().downloadQueue
                            const activeItems = allItems.filter(i => i.status === 'downloading')
                            const currentGlobalSpeed = activeItems.reduce((acc, i) => acc + (i.speed || 0), 0)
                            usePlayerStore.getState().updateDownloadStats({ currentSpeed: currentGlobalSpeed })
                        }, 50)
                    }
                }

            } catch (e) {
                console.error('[DownloadManager] WebSocket error:', e)
            }
        }

        ws.onerror = (error) => {
            console.error('[DownloadManager] WebSocket connection error:', error)
        }

        ws.onclose = () => {
            console.log('[DownloadManager] WebSocket connection closed')
        }

        return () => {
            ws.close()
        }
    }, [addDownloadItem, updateDownloadItem])

    // This component doesn't render anything - it just manages the WebSocket connection
    return null
}
