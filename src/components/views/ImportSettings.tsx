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
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog"
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
import { CodecPrioritySettings } from "@/components/settings/CodecPrioritySettings"

interface ImportSettingsProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    onSettingsUpdate?: () => void
}

interface GamdlSettings {
    outputPath: string
    songCodecs: string // Comma-separated list
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
    // Multi-language lyrics settings
    lyricsTranslationLangs: string
    lyricsPronunciationLangs: string
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
                updateData.songCodecs = settings.songCodecs
                updateData.lyricsFormat = settings.lyricsFormat
                updateData.coverSize = settings.coverSize
                updateData.saveCover = settings.saveCover
                updateData.language = settings.language
                updateData.overwrite = settings.overwrite
                updateData.syncEnabled = settings.syncEnabled
                updateData.syncInterval = settings.syncInterval
                updateData.autoSyncOnChange = settings.autoSyncOnChange
                updateData.lyricsTranslationLangs = settings.lyricsTranslationLangs
                updateData.lyricsPronunciationLangs = settings.lyricsPronunciationLangs
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

    const [showLyricsWarning, setShowLyricsWarning] = useState(false)
    const [pendingLyricsFormat, setPendingLyricsFormat] = useState<string>("")

    // ... (existing helper functions)

    const handleLyricsFormatChange = (value: string) => {
        if (!settings) return

        // If switching away from TTML, show warning
        if (value !== 'ttml' && settings.lyricsFormat === 'ttml') {
            setPendingLyricsFormat(value)
            setShowLyricsWarning(true)
        } else {
            setSettings({ ...settings, lyricsFormat: value })
        }
    }

    const confirmLyricsFormatChange = () => {
        if (!settings || !pendingLyricsFormat) return
        setSettings({ ...settings, lyricsFormat: pendingLyricsFormat })
        setShowLyricsWarning(false)
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

                    {/* Audio Formats - Multi-select */}
                    <div className="space-y-3">
                        <div>
                            <Label>Audio Formats</Label>
                            <p className="text-xs text-muted-foreground mt-1">
                                Select which audio formats to download. Multiple formats will increase storage usage.
                            </p>
                        </div>

                        {/* Storage estimate */}
                        {(() => {
                            const selectedCodecs = (settings.songCodecs || 'aac-legacy').split(',').filter(Boolean)
                            const sizeMultipliers: Record<string, number> = {
                                'aac-legacy': 1,
                                'aac-he-legacy': 0.3,
                                'aac': 1,
                                'aac-he': 0.3,
                                'aac-binaural': 1.2,
                                'aac-he-binaural': 0.4,
                                'aac-downmix': 1,
                                'aac-he-downmix': 0.3,
                                'atmos': 3,
                                'ac3': 2.5,
                                'alac': 4
                            }
                            const totalMultiplier = selectedCodecs.reduce((sum, c) => sum + (sizeMultipliers[c] || 1), 0)
                            const estimatePerSong = Math.round(totalMultiplier * 8) // ~8MB per song for AAC
                            return totalMultiplier > 1 ? (
                                <div className="text-xs px-3 py-2 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400">
                                    Estimated size: ~{estimatePerSong}MB per song ({selectedCodecs.length} format{selectedCodecs.length > 1 ? 's' : ''})
                                </div>
                            ) : null
                        })()}

                        {/* Standard Codecs */}
                        <div className="space-y-2">
                            <span className="text-xs text-muted-foreground font-medium">Standard</span>
                            <div className="flex flex-wrap gap-2">
                                {[
                                    { id: 'aac-legacy', label: 'AAC 256kbps', desc: '44.1kHz', recommended: true },
                                    { id: 'aac-he-legacy', label: 'AAC-HE 64kbps', desc: 'Low quality' },
                                ].map((codec) => {
                                    const selectedList = (settings.songCodecs || 'aac-legacy').split(',').filter(Boolean)
                                    const isSelected = selectedList.includes(codec.id)
                                    return (
                                        <button
                                            key={codec.id}
                                            type="button"
                                            onClick={() => {
                                                const updated = isSelected
                                                    ? selectedList.filter(c => c !== codec.id)
                                                    : [...selectedList, codec.id]
                                                // Ensure at least one codec is selected
                                                if (updated.length === 0) updated.push('aac-legacy')
                                                setSettings({ ...settings, songCodecs: updated.join(',') })
                                            }}
                                            className={cn(
                                                "px-3 py-1.5 text-xs font-medium rounded-full border transition-colors",
                                                isSelected
                                                    ? "bg-primary text-primary-foreground border-primary"
                                                    : "bg-background border-border hover:bg-muted"
                                            )}
                                        >
                                            {codec.label}
                                            {codec.recommended && !isSelected && (
                                                <span className="ml-1 text-primary">★</span>
                                            )}
                                        </button>
                                    )
                                })}
                            </div>
                        </div>

                        {/* Hi-Res / Experimental Codecs */}
                        <div className="space-y-2">
                            <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">Hi-Res / Spatial (Experimental)</span>
                            <div className="flex flex-wrap gap-2">
                                {[
                                    { id: 'alac', label: 'Lossless', desc: 'Up to 24-bit/192kHz' },
                                    { id: 'atmos', label: 'Dolby Atmos', desc: '768kbps spatial' },
                                    { id: 'aac-binaural', label: 'Spatial Audio', desc: 'Binaural' },
                                    { id: 'aac-he-binaural', label: 'HE Spatial', desc: 'HE Binaural' },
                                    { id: 'ac3', label: 'AC3', desc: '640kbps surround' },
                                    { id: 'aac-downmix', label: 'Downmix', desc: 'Stereo from surround' },
                                    { id: 'aac-he-downmix', label: 'HE Downmix', desc: 'HE stereo from surround' },
                                ].map((codec) => {
                                    const selectedList = (settings.songCodecs || 'aac-legacy').split(',').filter(Boolean)
                                    const isSelected = selectedList.includes(codec.id)
                                    return (
                                        <button
                                            key={codec.id}
                                            type="button"
                                            onClick={() => {
                                                const updated = isSelected
                                                    ? selectedList.filter(c => c !== codec.id)
                                                    : [...selectedList, codec.id]
                                                if (updated.length === 0) updated.push('aac-legacy')
                                                setSettings({ ...settings, songCodecs: updated.join(',') })
                                            }}
                                            className={cn(
                                                "px-3 py-1.5 text-xs font-medium rounded-full border transition-colors",
                                                isSelected
                                                    ? "bg-amber-500 text-white border-amber-500"
                                                    : "bg-background border-border hover:bg-muted"
                                            )}
                                            title={codec.desc}
                                        >
                                            {codec.label}
                                        </button>
                                    )
                                })}
                            </div>
                            <p className="text-xs text-muted-foreground">
                                These formats may not be available for all tracks.
                            </p>
                        </div>
                    </div>

                    {/* Lyrics Format */}
                    <div className="space-y-2">
                        <Label>Synced Lyrics Format</Label>
                        <Select
                            value={settings.lyricsFormat}
                            onValueChange={handleLyricsFormatChange}
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

                    {/* Lyrics Translation Languages */}
                    {settings.lyricsFormat === 'ttml' && (
                        <div className="space-y-2">
                            <Label>Lyrics Translation Languages</Label>
                            <div className="flex flex-wrap gap-2">
                                {['en', 'it', 'es', 'fr', 'de', 'ja', 'ko', 'pt', 'zh'].map((lang) => {
                                    const selected = (settings.lyricsTranslationLangs || '').split(',').filter(Boolean).includes(lang)
                                    return (
                                        <button
                                            key={lang}
                                            type="button"
                                            onClick={() => {
                                                const current = (settings.lyricsTranslationLangs || '').split(',').filter(Boolean)
                                                const updated = selected
                                                    ? current.filter(l => l !== lang)
                                                    : [...current, lang]
                                                setSettings({ ...settings, lyricsTranslationLangs: updated.join(',') })
                                            }}
                                            className={cn(
                                                "px-3 py-1.5 text-xs font-medium rounded-full border transition-colors",
                                                selected
                                                    ? "bg-primary text-primary-foreground border-primary"
                                                    : "bg-background border-border hover:bg-muted"
                                            )}
                                        >
                                            {lang.toUpperCase()}
                                        </button>
                                    )
                                })}
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Fetch translated lyrics for selected languages
                            </p>
                        </div>
                    )}

                    {/* Lyrics Pronunciation Languages */}
                    {settings.lyricsFormat === 'ttml' && (
                        <div className="space-y-2">
                            <Label>Romanization (Pronunciation)</Label>
                            <div className="flex flex-wrap gap-2">
                                {['ja-Latn', 'ko-Latn', 'zh-Latn', 'ar-Latn', 'hi-Latn', 'th-Latn'].map((script) => {
                                    const selected = (settings.lyricsPronunciationLangs || '').split(',').filter(Boolean).includes(script)
                                    const displayName = script.split('-')[0].toUpperCase() + ' → Latin'
                                    return (
                                        <button
                                            key={script}
                                            type="button"
                                            onClick={() => {
                                                const current = (settings.lyricsPronunciationLangs || '').split(',').filter(Boolean)
                                                const updated = selected
                                                    ? current.filter(s => s !== script)
                                                    : [...current, script]
                                                setSettings({ ...settings, lyricsPronunciationLangs: updated.join(',') })
                                            }}
                                            className={cn(
                                                "px-3 py-1.5 text-xs font-medium rounded-full border transition-colors",
                                                selected
                                                    ? "bg-primary text-primary-foreground border-primary"
                                                    : "bg-background border-border hover:bg-muted"
                                            )}
                                        >
                                            {displayName}
                                        </button>
                                    )
                                })}
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Fetch romanized pronunciation for non-Latin scripts
                            </p>
                        </div>
                    )}

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
                                            <SelectItem value="0.17">Every 10 seconds (testing)</SelectItem>
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

                    {/* Codec Priority */}
                    <div className="pt-4 border-t">
                        <CodecPrioritySettings />
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

                {/* Warning Dialog for Lyrics Format */}
                <AlertDialog open={showLyricsWarning} onOpenChange={setShowLyricsWarning}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Word-synced Lyrics Unavailable</AlertDialogTitle>
                            <AlertDialogDescription>
                                Word-by-word synced lyrics (syllable lyrics) are only supported when using the <strong>TTML</strong> format.
                                Changing this setting will default future downloads to line-by-line sync.
                                Are you sure you want to change it?
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel onClick={() => setPendingLyricsFormat("")}>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={confirmLyricsFormatChange}>Change Format</AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </SheetContent>
        </Sheet>
    )
}
