"use client"

import * as React from "react"
import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import {
    X,
    Trash2,
    Clock,
    CheckCircle2,
    XCircle,
    FileText,
    Download as DownloadIcon,
    HardDrive,
    Gauge,
    Timer
} from "lucide-react"
import { cn } from "@/lib/utils"

export interface DownloadItem {
    id: string
    trackId: string
    title: string
    artist: string
    album: string
    status: 'queued' | 'downloading' | 'completed' | 'skipped' | 'failed'
    progress?: number // 0-100
    fileSize?: number // bytes
    filePath?: string
    reason?: string // for skipped/failed
    startTime?: number
    endTime?: number
}

interface QueueStats {
    queued: number
    completed: number
    skipped: number
    failed: number
    totalBytes: number
    currentSpeed: number // bytes per second
    elapsedSeconds: number
}

interface DownloadQueueProps {
    open: boolean
    onClose: () => void
}

export function DownloadQueue({ open, onClose }: DownloadQueueProps) {
    const [items, setItems] = useState<DownloadItem[]>([])
    const [stats, setStats] = useState<QueueStats>({
        queued: 0,
        completed: 0,
        skipped: 0,
        failed: 0,
        totalBytes: 0,
        currentSpeed: 0,
        elapsedSeconds: 0
    })

    // Subscribe to WebSocket events for download progress
    useEffect(() => {
        if (!open) return

        // Connect to WebSocket for real-time updates
        const ws = new WebSocket('ws://localhost:5101')

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data)
                handleDownloadEvent(data)
            } catch (e) {
                console.error('Failed to parse WebSocket message:', e)
            }
        }

        ws.onerror = (error) => {
            console.error('WebSocket error:', error)
        }

        return () => {
            ws.close()
        }
    }, [open])

    const handleDownloadEvent = (event: any) => {
        switch (event.type) {
            case 'download_started':
                setItems(prev => [...prev, {
                    id: event.track_id,
                    trackId: event.track_id,
                    title: event.title || 'Unknown Track',
                    artist: event.artist || 'Unknown Artist',
                    album: event.album || 'Unknown Album',
                    status: 'downloading',
                    progress: 0,
                    startTime: Date.now()
                }])
                setStats(prev => ({ ...prev, queued: prev.queued > 0 ? prev.queued - 1 : 0 }))
                break

            case 'download_progress':
                setItems(prev => prev.map(item =>
                    item.trackId === event.track_id
                        ? { ...item, progress: event.progress_pct, fileSize: event.bytes }
                        : item
                ))
                setStats(prev => ({ ...prev, currentSpeed: event.speed || 0 }))
                break

            case 'download_complete':
                setItems(prev => prev.map(item =>
                    item.trackId === event.track_id
                        ? {
                            ...item,
                            status: 'completed',
                            progress: 100,
                            filePath: event.file_path,
                            fileSize: event.file_size,
                            endTime: Date.now()
                        }
                        : item
                ))
                setStats(prev => ({
                    ...prev,
                    completed: prev.completed + 1,
                    totalBytes: prev.totalBytes + (event.file_size || 0)
                }))
                break

            case 'download_skipped':
                setItems(prev => prev.map(item =>
                    item.trackId === event.track_id
                        ? { ...item, status: 'skipped', reason: event.reason || 'File already exists' }
                        : item
                ))
                setStats(prev => ({ ...prev, skipped: prev.skipped + 1 }))
                break

            case 'download_failed':
                setItems(prev => prev.map(item =>
                    item.trackId === event.track_id
                        ? { ...item, status: 'failed', reason: event.error }
                        : item
                ))
                setStats(prev => ({ ...prev, failed: prev.failed + 1 }))
                break

            case 'queue_update':
                setStats(prev => ({
                    ...prev,
                    queued: event.queued ?? prev.queued,
                    completed: event.completed ?? prev.completed,
                    skipped: event.skipped ?? prev.skipped,
                    failed: event.failed ?? prev.failed
                }))
                break
        }
    }

    const clearHistory = () => {
        setItems([])
        setStats({
            queued: 0,
            completed: 0,
            skipped: 0,
            failed: 0,
            totalBytes: 0,
            currentSpeed: 0,
            elapsedSeconds: 0
        })
    }

    const formatBytes = (bytes: number) => {
        if (bytes === 0) return '0.00 MB'
        const mb = bytes / (1024 * 1024)
        return `${mb.toFixed(2)} MB`
    }

    const formatSpeed = (bytesPerSecond: number) => {
        if (bytesPerSecond === 0) return '-'
        const mbps = bytesPerSecond / (1024 * 1024)
        return `${mbps.toFixed(2)} MB/s`
    }

    const formatDuration = (seconds: number) => {
        if (seconds === 0) return '-'
        const mins = Math.floor(seconds / 60)
        const secs = Math.floor(seconds % 60)
        return `${mins}:${secs.toString().padStart(2, '0')}`
    }

    const getStatusIcon = (status: DownloadItem['status']) => {
        switch (status) {
            case 'queued':
                return <Clock className="h-4 w-4 text-muted-foreground" />
            case 'downloading':
                return <DownloadIcon className="h-4 w-4 text-blue-500 animate-pulse" />
            case 'completed':
                return <CheckCircle2 className="h-4 w-4 text-green-500" />
            case 'skipped':
                return <FileText className="h-4 w-4 text-amber-500" />
            case 'failed':
                return <XCircle className="h-4 w-4 text-red-500" />
        }
    }

    const getStatusBadge = (status: DownloadItem['status']) => {
        const styles = {
            queued: 'bg-muted text-muted-foreground',
            downloading: 'bg-blue-500/10 text-blue-600',
            completed: 'bg-green-500/10 text-green-600',
            skipped: 'bg-amber-500/10 text-amber-600',
            failed: 'bg-red-500/10 text-red-600'
        }
        return (
            <span className={cn(
                "px-2 py-0.5 rounded text-xs font-medium",
                styles[status]
            )}>
                {status}
            </span>
        )
    }

    if (!open) return null

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-background rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col m-4">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b">
                    <h2 className="text-xl font-bold">Download Queue</h2>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={clearHistory}
                            className="text-muted-foreground hover:text-foreground"
                        >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Clear History
                        </Button>
                        <Button variant="ghost" size="icon" onClick={onClose}>
                            <X className="h-4 w-4" />
                        </Button>
                    </div>
                </div>

                {/* Stats Bar */}
                <div className="px-6 py-3 border-b bg-muted/30">
                    <div className="flex items-center gap-6 text-sm">
                        <div className="flex items-center gap-1.5">
                            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="text-muted-foreground">Queued:</span>
                            <span className="font-medium">{stats.queued}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                            <span className="text-muted-foreground">Completed:</span>
                            <span className="font-medium">{stats.completed}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <FileText className="h-3.5 w-3.5 text-amber-500" />
                            <span className="text-muted-foreground">Skipped:</span>
                            <span className="font-medium">{stats.skipped}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <XCircle className="h-3.5 w-3.5 text-red-500" />
                            <span className="text-muted-foreground">Failed:</span>
                            <span className="font-medium">{stats.failed}</span>
                        </div>
                    </div>
                </div>

                {/* Summary Stats */}
                <div className="px-6 py-3 border-b flex items-center gap-8 text-sm text-muted-foreground">
                    <div className="flex items-center gap-2">
                        <HardDrive className="h-4 w-4" />
                        <span>Downloaded:</span>
                        <span className="font-medium text-foreground">{formatBytes(stats.totalBytes)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <Gauge className="h-4 w-4" />
                        <span>Speed:</span>
                        <span className="font-medium text-foreground">{formatSpeed(stats.currentSpeed)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <Timer className="h-4 w-4" />
                        <span>Duration:</span>
                        <span className="font-medium text-foreground">{formatDuration(stats.elapsedSeconds)}</span>
                    </div>
                </div>

                {/* Track List */}
                <div className="flex-1 overflow-auto p-4 space-y-2">
                    {items.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                            <DownloadIcon className="h-12 w-12 mb-4 opacity-50" />
                            <p>No downloads yet</p>
                            <p className="text-sm">Start a download from the Import page</p>
                        </div>
                    ) : (
                        items.map((item) => (
                            <div
                                key={item.id}
                                className="p-4 rounded-lg border bg-card"
                            >
                                <div className="flex items-start justify-between">
                                    <div className="flex items-start gap-3">
                                        <div className="mt-0.5">
                                            {getStatusIcon(item.status)}
                                        </div>
                                        <div className="space-y-1">
                                            <h4 className="font-semibold">{item.title}</h4>
                                            <p className="text-sm text-muted-foreground">
                                                {item.artist} • {item.album}
                                            </p>
                                            {item.reason && (
                                                <p className="text-sm text-muted-foreground">
                                                    {item.reason}
                                                </p>
                                            )}
                                            {item.fileSize && item.status === 'completed' && (
                                                <p className="text-sm text-muted-foreground">
                                                    {formatBytes(item.fileSize)}
                                                </p>
                                            )}
                                            {item.filePath && (
                                                <p className="text-xs text-muted-foreground font-mono truncate max-w-md">
                                                    {item.filePath}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                    {getStatusBadge(item.status)}
                                </div>

                                {/* Progress bar for downloading items */}
                                {item.status === 'downloading' && item.progress !== undefined && (
                                    <div className="mt-3">
                                        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                                            <div
                                                className="h-full bg-blue-500 transition-all duration-300"
                                                style={{ width: `${item.progress}%` }}
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    )
}
