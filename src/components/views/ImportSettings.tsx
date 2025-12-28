"use client"

import * as React from "react"
import { useState, useEffect } from "react"
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetDescription,
    VisuallyHidden,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react"
import { cn } from "@/lib/utils"

interface ImportSettingsProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    onSettingsUpdate?: () => void
}

interface GamdlSettings {
    outputPath: string
    songCodec: string
    lyricsFormat: string
    coverSize: number
    saveCover: boolean
    language: string
    overwrite: boolean
    cookiesConfigured: boolean
    serviceOnline: boolean
    // Sync settings
    syncEnabled: boolean
    syncInterval: number
    autoSyncOnChange: boolean
}

export function ImportSettings({ open, onOpenChange, onSettingsUpdate }: ImportSettingsProps) {
    const [settings, setSettings] = useState<GamdlSettings | null>(null)
    const [cookies, setCookies] = useState("")
    const [isLoading, setIsLoading] = useState(false)
    const [isSaving, setIsSaving] = useState(false)
    const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle')

    // Fetch settings when sheet opens
    useEffect(() => {
        if (open) {
            fetchSettings()
        }
    }, [open])

    const fetchSettings = async () => {
        setIsLoading(true)
        try {
            const res = await fetch('/api/import/settings')
            if (res.ok) {
                const data = await res.json()
                setSettings(data)
            }
        } catch (err) {
            console.error('Failed to fetch settings:', err)
        } finally {
            setIsLoading(false)
        }
    }

    const handleSave = async () => {
        setIsSaving(true)
        setSaveStatus('idle')

        try {
            const updateData: Record<string, unknown> = {}

            if (settings) {
                updateData.outputPath = settings.outputPath
                updateData.songCodec = settings.songCodec
                updateData.lyricsFormat = settings.lyricsFormat
                updateData.coverSize = settings.coverSize
                updateData.saveCover = settings.saveCover
                updateData.language = settings.language
                updateData.overwrite = settings.overwrite
                updateData.syncEnabled = settings.syncEnabled
                updateData.syncInterval = settings.syncInterval
                updateData.autoSyncOnChange = settings.autoSyncOnChange
            }

            // Only include cookies if user entered new ones
            if (cookies.trim()) {
                updateData.cookies = cookies.trim()
            }

            const res = await fetch('/api/import/settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updateData)
            })

            if (res.ok) {
                setSaveStatus('success')
                setCookies("") // Clear cookies field
                onSettingsUpdate?.()
                await fetchSettings() // Refresh settings
                setTimeout(() => setSaveStatus('idle'), 2000)
            } else {
                setSaveStatus('error')
            }
        } catch (err) {
            console.error('Failed to save settings:', err)
            setSaveStatus('error')
        } finally {
            setIsSaving(false)
        }
    }

    if (isLoading || !settings) {
        return (
            <Sheet open={open} onOpenChange={onOpenChange}>
                <SheetContent className="sm:max-w-lg overflow-y-auto">
                    <VisuallyHidden>
                        <SheetTitle>Loading import settings</SheetTitle>
                    </VisuallyHidden>
                    <div className="flex items-center justify-center py-12">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                </SheetContent>
            </Sheet>
        )
    }

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent className="sm:max-w-lg overflow-y-auto">
                <SheetHeader>
                    <SheetTitle>Import Settings</SheetTitle>
                    <SheetDescription>
                        Configure Apple Music download settings
                    </SheetDescription>
                </SheetHeader>

                <div className="space-y-6 py-6">
                    {/* Service Status */}
                    <div className={cn(
                        "flex items-center gap-2 px-3 py-2 rounded-lg text-sm",
                        settings.serviceOnline
                            ? "bg-green-500/10 text-green-600 dark:text-green-400"
                            : "bg-red-500/10 text-red-600 dark:text-red-400"
                    )}>
                        <div className={cn(
                            "w-2 h-2 rounded-full",
                            settings.serviceOnline ? "bg-green-500" : "bg-red-500"
                        )} />
                        {settings.serviceOnline
                            ? "gamdl service is running"
                            : "gamdl service is not running"}
                    </div>

                    {/* Cookies */}
                    <div className="space-y-2">
                        <Label>Apple Music Cookies</Label>
                        <div className="space-y-2">
                            <div className={cn(
                                "flex items-center gap-2 text-sm",
                                settings.cookiesConfigured
                                    ? "text-green-600 dark:text-green-400"
                                    : "text-amber-600 dark:text-amber-400"
                            )}>
                                {settings.cookiesConfigured ? (
                                    <>
                                        <CheckCircle2 className="h-4 w-4" />
                                        Cookies configured
                                    </>
                                ) : (
                                    <>
                                        <AlertCircle className="h-4 w-4" />
                                        Cookies not configured
                                    </>
                                )}
                            </div>
                            <Textarea
                                placeholder="Paste your Netscape format cookies here..."
                                value={cookies}
                                onChange={(e) => setCookies(e.target.value)}
                                rows={4}
                                className="font-mono text-xs"
                            />
                            <p className="text-xs text-muted-foreground">
                                Export cookies from your browser while logged into Apple Music.
                                Use &quot;Export Cookies&quot; (Firefox) or &quot;Get cookies.txt LOCALLY&quot; (Chrome).
                            </p>
                        </div>
                    </div>

                    {/* Output Path */}
                    <div className="space-y-2">
                        <Label>Output Path</Label>
                        <Input
                            value={settings.outputPath}
                            onChange={(e) => setSettings({ ...settings, outputPath: e.target.value })}
                            placeholder="./music"
                        />
                        <p className="text-xs text-muted-foreground">
                            Directory where downloaded files will be saved
                        </p>
                    </div>

                    {/* Song Codec */}
                    <div className="space-y-2">
                        <Label>Audio Quality</Label>
                        <Select
                            value={settings.songCodec}
                            onValueChange={(value) => setSettings({ ...settings, songCodec: value })}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="Select codec" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="aac-legacy">AAC 256kbps (Recommended)</SelectItem>
                                <SelectItem value="aac-he-legacy">AAC-HE 64kbps (Low quality)</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Lyrics Format */}
                    <div className="space-y-2">
                        <Label>Synced Lyrics Format</Label>
                        <Select
                            value={settings.lyricsFormat}
                            onValueChange={(value) => setSettings({ ...settings, lyricsFormat: value })}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="Select format" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="lrc">LRC (Most compatible)</SelectItem>
                                <SelectItem value="srt">SRT (SubRip)</SelectItem>
                                <SelectItem value="ttml">TTML (Apple native)</SelectItem>
                                <SelectItem value="none">None</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Cover Size */}
                    <div className="space-y-2">
                        <Label>Cover Art Size</Label>
                        <Input
                            type="number"
                            value={settings.coverSize}
                            onChange={(e) => setSettings({ ...settings, coverSize: parseInt(e.target.value) || 1200 })}
                            min={100}
                            max={3000}
                        />
                        <p className="text-xs text-muted-foreground">
                            Cover art resolution in pixels (default: 1200)
                        </p>
                    </div>

                    {/* Language */}
                    <div className="space-y-2">
                        <Label>Metadata Language</Label>
                        <Input
                            value={settings.language}
                            onChange={(e) => setSettings({ ...settings, language: e.target.value })}
                            placeholder="en-US"
                        />
                        <p className="text-xs text-muted-foreground">
                            ISO language code (e.g., en-US, ja-JP, es-ES)
                        </p>
                    </div>

                    {/* Toggles */}
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                                <Label>Save Cover Art</Label>
                                <p className="text-xs text-muted-foreground">
                                    Save cover as separate file
                                </p>
                            </div>
                            <Switch
                                checked={settings.saveCover}
                                onCheckedChange={(checked) => setSettings({ ...settings, saveCover: checked })}
                            />
                        </div>

                        <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                                <Label>Overwrite Existing</Label>
                                <p className="text-xs text-muted-foreground">
                                    Replace existing files
                                </p>
                            </div>
                            <Switch
                                checked={settings.overwrite}
                                onCheckedChange={(checked) => setSettings({ ...settings, overwrite: checked })}
                            />
                        </div>
                    </div>

                    {/* Playlist Sync Settings */}
                    <div className="space-y-4 pt-4 border-t">
                        <h3 className="text-sm font-medium">Playlist Sync</h3>

                        <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                                <Label>Enable Auto Sync</Label>
                                <p className="text-xs text-muted-foreground">
                                    Automatically sync Apple Music playlists
                                </p>
                            </div>
                            <Switch
                                checked={settings.syncEnabled}
                                onCheckedChange={(checked) => setSettings({ ...settings, syncEnabled: checked })}
                            />
                        </div>

                        {settings.syncEnabled && (
                            <>
                                <div className="space-y-2">
                                    <Label>Sync Interval</Label>
                                    <Select
                                        value={settings.syncInterval.toString()}
                                        onValueChange={(value) => setSettings({ ...settings, syncInterval: parseInt(value) })}
                                    >
                                        <SelectTrigger>
                                            <SelectValue placeholder="Select interval" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="15">Every 15 minutes</SelectItem>
                                            <SelectItem value="30">Every 30 minutes</SelectItem>
                                            <SelectItem value="60">Every hour</SelectItem>
                                            <SelectItem value="360">Every 6 hours</SelectItem>
                                            <SelectItem value="1440">Every 24 hours</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <p className="text-xs text-muted-foreground">
                                        How often to check for playlist updates
                                    </p>
                                </div>

                                <div className="flex items-center justify-between pt-2">
                                    <div className="space-y-0.5">
                                        <Label>Auto-sync on Change</Label>
                                        <p className="text-xs text-muted-foreground">
                                            Automatically download updates when detected
                                        </p>
                                    </div>
                                    <Switch
                                        checked={settings.autoSyncOnChange}
                                        onCheckedChange={(checked) => setSettings({ ...settings, autoSyncOnChange: checked })}
                                    />
                                </div>
                            </>
                        )}
                    </div>
                </div>

                {/* Save Button */}
                <div className="pt-4 border-t">
                    <Button
                        className="w-full"
                        onClick={handleSave}
                        disabled={isSaving}
                    >
                        {isSaving ? (
                            <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                Saving...
                            </>
                        ) : saveStatus === 'success' ? (
                            <>
                                <CheckCircle2 className="h-4 w-4 mr-2" />
                                Saved!
                            </>
                        ) : saveStatus === 'error' ? (
                            <>
                                <AlertCircle className="h-4 w-4 mr-2" />
                                Failed to save
                            </>
                        ) : (
                            'Save Settings'
                        )}
                    </Button>
                </div>
            </SheetContent>
        </Sheet>
    )
}
