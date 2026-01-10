"use client"

import * as React from "react"
import { useState, useEffect, useCallback } from "react"
import { usePlayerStore, DownloadItem } from "@/lib/store"
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


interface DownloadQueueProps {
    open: boolean
    onClose: () => void
}

export function DownloadQueue({ open, onClose }: DownloadQueueProps) {
    const { downloadQueue: items, downloadStats: stats, clearCompletedDownloads } = usePlayerStore()

    // No local WebSocket listener needed - handled globally in Player component


    const clearHistory = () => {
        items.forEach(item => {
            if (item.status === 'completed' || item.status === 'failed') {
                clearCompletedDownloads()
            }
        })
    }

    const formatBytes = (bytes: number) => {
        if (!bytes || bytes === 0) return '0 B'
        const k = 1024
        const sizes = ['B', 'KB', 'MB', 'GB']
        const i = Math.floor(Math.log(bytes) / Math.log(k))
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
    }

    const formatSpeed = (bytesPerSecond: number) => {
        if (!bytesPerSecond || bytesPerSecond === 0) return '0 KB/s'
        return `${formatBytes(bytesPerSecond)}/s`
    }

    const formatDuration = (seconds: number) => {
        if (!seconds || seconds === 0) return '-'
        const mins = Math.floor(seconds / 60)
        const secs = Math.floor(seconds % 60)
        return `${mins}:${secs.toString().padStart(2, '0')}`
    }

    // Calculate aggregate stats from codec-level data
    const calculateAggregates = (item: DownloadItem) => {
        const codecTotalBytes = item.codecTotalBytes || {}
        const codecLoadedBytes = item.codecLoadedBytes || {}
        const codecSpeed = item.codecSpeed || {}

        const totalBytes = Object.values(codecTotalBytes).reduce((a, b) => a + b, 0)
        const loadedBytes = Object.values(codecLoadedBytes).reduce((a, b) => a + b, 0)
        const speed = Object.values(codecSpeed).reduce((a, b) => a + b, 0)

        // Calculate progress based on loaded/total bytes
        let progress = 0
        if (totalBytes > 0) {
            progress = Math.min(100, Math.max(0, (loadedBytes / totalBytes) * 100))
        }

        // Calculate ETA
        let eta = 0
        if (speed > 0 && totalBytes > loadedBytes) {
            eta = (totalBytes - loadedBytes) / speed
        }

        return { totalBytes, loadedBytes, speed, progress, eta }
    }

    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'pending':
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

    const getStatusBadge = (status: string) => {
        const styles: Record<string, string> = {
            queued: 'bg-muted text-muted-foreground',
            pending: 'bg-muted text-muted-foreground',
            downloading: 'bg-blue-500/10 text-blue-600',
            completed: 'bg-green-500/10 text-green-600',
            skipped: 'bg-amber-500/10 text-amber-600',
            failed: 'bg-red-500/10 text-red-600'
        }
        return (
            <span className={cn(
                "px-2 py-0.5 rounded text-xs font-medium capitalize",
                styles[status] || styles.pending
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
                            onClick={() => clearCompletedDownloads()}
                            className="text-muted-foreground hover:text-foreground"
                        >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Clear Completed
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
                            <span className="font-medium">{items.filter(i => i.status === 'queued' || i.status === 'pending').length}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <DownloadIcon className="h-3.5 w-3.5 text-blue-500" />
                            <span className="text-muted-foreground">Active:</span>
                            <span className="font-medium">{stats.activeDownloads}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                            <span className="text-muted-foreground">Completed:</span>
                            <span className="font-medium">{stats.completedDownloads}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <FileText className="h-3.5 w-3.5 text-amber-500" />
                            <span className="text-muted-foreground">Skipped:</span>
                            <span className="font-medium">{items.filter(i => i.status === 'skipped').length}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <XCircle className="h-3.5 w-3.5 text-red-500" />
                            <span className="text-muted-foreground">Failed:</span>
                            <span className="font-medium">{stats.failedDownloads}</span>
                        </div>
                    </div>
                </div>

                {/* Summary Stats */}
                <div className="px-6 py-3 border-b flex items-center gap-8 text-sm text-muted-foreground">
                    <div className="flex items-center gap-2">
                        <HardDrive className="h-4 w-4" />
                        <span>Downloaded:</span>
                        <span className="font-medium text-foreground">{stats.completedDownloads} items</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <Gauge className="h-4 w-4" />
                        <span>Speed:</span>
                        <span className="font-medium text-foreground">
                            {stats.activeDownloads > 0 ? formatSpeed(stats.currentSpeed || 0) : '0 KB/s'}
                        </span>
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
                        items.map((item, index) => (
                            <div
                                key={`${item.id}-${index}`}
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
                                            {item.status === 'completed' && (
                                                <p className="text-sm text-muted-foreground">
                                                    {formatBytes(calculateAggregates(item).totalBytes || item.fileSize || 0)}
                                                </p>
                                            )}
                                            {/* Codec badges for completed downloads */}
                                            {item.status === 'completed' && item.downloadedCodecs && item.downloadedCodecs.length > 0 && (
                                                <div className="flex flex-wrap gap-1.5 mt-1">
                                                    {item.downloadedCodecs.map((codec) => {
                                                        // Color coding for codecs
                                                        let colorClass = "bg-primary/20 text-primary border-primary/30" // Standard
                                                        if (['alac', 'flac'].includes(codec) || codec.includes('lossless')) {
                                                            colorClass = "bg-purple-500/20 text-purple-600 dark:text-purple-400 border-purple-500/30" // Hi-Res
                                                        } else if (['atmos', 'ac3', 'aac-binaural', 'aac-he-binaural'].includes(codec) || codec.includes('spatial')) {
                                                            colorClass = "bg-sky-500/20 text-sky-600 dark:text-sky-400 border-sky-500/30" // Spatial
                                                        }

                                                        const codecLabels: Record<string, string> = {
                                                            'aac-legacy': 'AAC',
                                                            'aac-he-legacy': 'AAC-HE',
                                                            'aac': 'AAC 48kHz',
                                                            'aac-he': 'AAC-HE 48kHz',
                                                            'alac': 'Lossless',
                                                            'atmos': 'Dolby Atmos',
                                                            'aac-binaural': 'Spatial',
                                                            'aac-he-binaural': 'Spatial HE',
                                                            'aac-downmix': 'Downmix',
                                                            'aac-he-downmix': 'HE Downmix',
                                                            'ac3': 'AC3',
                                                        }
                                                        const label = codecLabels[codec] || codec.toUpperCase()

                                                        return (
                                                            <span
                                                                key={codec}
                                                                className={cn(
                                                                    "px-1.5 py-0.5 rounded text-[10px] font-medium border",
                                                                    colorClass
                                                                )}
                                                            >
                                                                {label}
                                                            </span>
                                                        )
                                                    })}
                                                </div>
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
                                {item.status === 'downloading' && (() => {
                                    // Calculate aggregates from merged codec data
                                    const { totalBytes, loadedBytes, speed, progress, eta } = calculateAggregates(item)

                                    return (
                                        <div className="mt-3 space-y-2">
                                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                                                <div className="flex items-center gap-2">
                                                    <span>
                                                        {loadedBytes > 0 && totalBytes > 0
                                                            ? `${formatBytes(loadedBytes)} / ${formatBytes(totalBytes)}`
                                                            : `Downloading ${Object.keys(item.codecStatus || {}).length} codecs...`}
                                                    </span>
                                                    {speed > 0 && (
                                                        <span className="text-muted-foreground/70 border-l pl-2 border-border/50">
                                                            {formatSpeed(speed)}
                                                        </span>
                                                    )}
                                                    {eta > 0 && (
                                                        <span className="text-muted-foreground/70 border-l pl-2 border-border/50">
                                                            {formatDuration(eta)} remaining
                                                        </span>
                                                    )}
                                                </div>
                                                <span>{Math.round(progress)}%</span>
                                            </div>
                                            <div className="h-2 bg-muted rounded-full overflow-hidden">
                                                <div
                                                    className="h-full bg-primary transition-all duration-300"
                                                    style={{ width: `${progress}%` }}
                                                />
                                            </div>

                                            {/* Individual Codec Progress Bars */}
                                            {item.codecStatus && Object.keys(item.codecStatus).length > 0 && (
                                                <div className="flex flex-col gap-1.5 mt-2 pt-2 border-t border-border/50">
                                                    {Object.entries(item.codecStatus).map(([codec, status]) => {
                                                        const progress = item.codecProgress?.[codec] || 0
                                                        const isPending = status === 'pending'
                                                        const isDecrypting = status === 'decrypting'

                                                        // Color coding for codecs
                                                        let colorClass = "bg-blue-500" // Standard/Default
                                                        if (isPending) {
                                                            colorClass = "bg-muted/50" // Pending/Gray
                                                        } else if (isDecrypting) {
                                                            colorClass = "bg-amber-500 animate-pulse" // Decrypting/Amber
                                                        } else if (['alac', 'flac'].includes(codec) || codec.includes('lossless')) {
                                                            colorClass = "bg-purple-500" // Hi-Res
                                                        } else if (['atmos', 'ac3', 'aac-binaural'].includes(codec) || codec.includes('spatial')) {
                                                            colorClass = "bg-sky-400" // Spatial
                                                        }

                                                        return (
                                                            <div key={codec} className="flex items-center gap-2 text-[10px]">
                                                                <span className={cn("w-12 font-medium uppercase truncate", isPending ? "text-muted-foreground/50" : "text-muted-foreground")} title={codec}>
                                                                    {codec.replace('aac-', '')}
                                                                </span>
                                                                <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                                                                    <div
                                                                        className={cn("h-full transition-all duration-300", colorClass)}
                                                                        style={{ width: `${status === 'completed' ? 100 : progress}%` }}
                                                                    />
                                                                </div>
                                                                <span className={cn("w-10 text-right", isPending || isDecrypting ? "text-muted-foreground/50" : "text-muted-foreground")}>
                                                                    {status === 'completed' ? 'Done' : (isDecrypting ? 'Decrypt' : (isPending ? 'Wait' : `${Math.round(progress)}%`))}
                                                                </span>
                                                            </div>
                                                        )
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    )
                                })()}
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    )
}
