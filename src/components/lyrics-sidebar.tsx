"use client"

import * as React from "react"
import { memo, useCallback, useEffect, useRef, useState } from "react"
import { usePlayerStore } from "@/lib/store"
import { motion, AnimatePresence } from "motion/react"
import { cn } from "@/lib/utils"
import { Mic2, MessageSquare } from "lucide-react"
import { DynamicGradientBackground } from "@/components/ui/dynamic-gradient-background"
import { extractColorsFromImage, getAppleMusicFallbackColors } from "@/lib/color-extraction"
import type { LyricsLine, ParsedLyrics } from "@/lib/lyrics-parser"

// Apple Music-style breathing dots animation for instrumental pauses
// Only shown when lyrics have endTime (TTML/SRT), not for LRC format
const FINAL_INHALE_DURATION = 1.0 // seconds for the final inhale effect
const MIN_DOTS_DURATION = 1.5 // minimum seconds to show dots at all

const BreathingDots = memo(function BreathingDots({
    progress, // 0-1 representing progress through the gap (excluding final inhale)
    timeRemaining, // seconds remaining until next verse
    isPaused  // Whether playback is paused
}: {
    progress: number
    timeRemaining: number
    isPaused: boolean
}) {
    // Final inhale starts when time remaining is less than FINAL_INHALE_DURATION
    const isFinalApproach = timeRemaining <= FINAL_INHALE_DURATION && timeRemaining > 0

    // Calculate continuous color interpolation for each dot
    const getOpacity = (dotIndex: number) => {
        const fillPoint = (dotIndex + 1) / 3
        const fillStart = dotIndex / 3

        if (progress <= fillStart) return 0.2
        if (progress >= fillPoint) return 0.85

        const localProgress = (progress - fillStart) / (1 / 3)
        return 0.2 + localProgress * 0.65
    }

    return (
        <motion.div
            className="py-2 px-4"
            style={{ transformOrigin: 'left center' }}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{
                opacity: 1,
                scale: isPaused ? 1 : isFinalApproach
                    ? [1, 1.3, 0] // Final inhale then disappear
                    : [1, 1.1, 1], // Normal breathing
            }}
            exit={{ opacity: 0, scale: 1.3 }}
            transition={{
                opacity: { duration: 0.2 },
                scale: isFinalApproach
                    ? { duration: FINAL_INHALE_DURATION, ease: "easeOut" }
                    : {
                        duration: 2.5,
                        repeat: isPaused ? 0 : Infinity,
                        ease: "easeInOut"
                    }
            }}
        >
            <div className="flex items-center gap-[6px]">
                {[0, 1, 2].map((index) => (
                    <motion.div
                        key={index}
                        className="w-[6px] h-[6px] rounded-full"
                        animate={{
                            backgroundColor: `hsl(var(--foreground) / ${getOpacity(index)})`
                        }}
                        transition={{
                            backgroundColor: { duration: 0.1, ease: "linear" }
                        }}
                    />
                ))}
            </div>
        </motion.div>
    )
})

// Individual lyrics line component with Apple Music-style animation
// Supports progressive blur based on distance from active line
const LyricsLineComponent = memo(function LyricsLineComponent({
    line,
    isActive,
    isPast,
    distance, // Distance from active line (0 = active, 1 = next/prev, 2 = further, etc.)
    isUserScrolling, // If true, disable all blur
    onClick
}: {
    line: LyricsLine
    isActive: boolean
    isPast: boolean
    distance: number
    isUserScrolling: boolean
    onClick: () => void
}) {
    // Progressive blur: active = 0, next/prev = low blur, then increasing
    // distance 0: no blur (active), distance 1: slight blur, distance 2+: more blur
    // If user is scrolling, disable blur completely
    const blurAmount = isUserScrolling ? 0 : (distance === 0 ? 0 : Math.min(distance * 0.6, 3))

    return (
        <motion.div
            // Removed layout prop to prevent text distortion (squashing) during animation
            initial={{ opacity: 0.4, scale: 0.95 }}
            animate={{
                opacity: isActive || isUserScrolling ? 1 : isPast ? 0.4 : 0.6,
                scale: isActive ? 1 : 0.95,
                filter: `blur(${blurAmount}px)`,
            }}
            transition={{
                duration: 0.4,
                ease: [0.25, 0.1, 0.25, 1],
            }}
            onClick={onClick}
            className={cn(
                // Add transition-all for smooth font-size/height changes without layout distortion
                "cursor-pointer transition-all duration-400 ease-[cubic-bezier(0.25,0.1,0.25,1)] px-4 py-2 origin-left",
                // Only apply hover scale/opacity if NOT active
                !isActive && "hover:opacity-100 hover:scale-[0.98]",
                isActive
                    ? "text-white font-bold text-xl leading-relaxed drop-shadow-lg"
                    : isPast
                        ? "text-white/50 text-base"
                        : "text-white/70 text-base"
            )}
        >
            {line.text}
        </motion.div>
    )
})

// Empty/Loading/No lyrics states
const LyricsPlaceholder = memo(function LyricsPlaceholder({
    state,
    trackTitle,
    isLight
}: {
    state: 'loading' | 'no-lyrics' | 'no-track'
    trackTitle?: string
    isLight: boolean
}) {
    return (
        <div className={cn(
            "flex-1 flex flex-col items-center justify-center px-6 transition-colors duration-500",
            isLight ? "text-black/70" : "text-white/70"
        )}>
            {state === 'loading' && (
                <div className="animate-pulse flex flex-col items-center gap-3">
                    <Mic2 className="h-10 w-10 opacity-30" />
                    <span className="text-sm">Loading lyrics...</span>
                </div>
            )}
            {state === 'no-lyrics' && (
                <>
                    <div className="relative mb-3 opacity-30">
                        {/* Base bubble using MessageSquare (empty) */}
                        <MessageSquare className="h-14 w-14" strokeWidth={1.5} />

                        {/* Big Centered Quotes */}
                        <div className="absolute inset-0 flex items-center justify-center pb-3 pl-0.5">
                            <span className="text-4xl font-black leading-none select-none font-serif">&rdquo;</span>
                        </div>

                        {/* Bolder, Longer Slash */}
                        <div className="absolute inset-0 flex items-center justify-center">
                            <div className="w-[130%] h-[3px] bg-current -rotate-45 origin-center rounded-full" />
                        </div>
                    </div>
                    <span className="text-sm text-center">
                        No lyrics available
                        {trackTitle && (
                            <>
                                <br />
                                <span className="opacity-60">for &quot;{trackTitle}&quot;</span>
                            </>
                        )}
                    </span>
                </>
            )}
            {state === 'no-track' && (
                <>
                    <Mic2 className="h-10 w-10 opacity-20 mb-3" />
                    <span className="text-sm">Play a song to see lyrics</span>
                </>
            )}
        </div>
    )
})

// Threshold in seconds to show breathing dots (instrumental pause)
const PAUSE_THRESHOLD = 4.0

// Helper to determine if color is light
const isLightColor = (hex: string) => {
    if (!hex) return false
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    // YIQ equation
    const brightness = ((r * 299) + (g * 587) + (b * 114)) / 1000
    return brightness > 180 // Higher threshold because of the black/50 overlay
}

// Lyrics panel content (separated for AnimatePresence)
const LyricsPanelContent = memo(function LyricsPanelContent({
    gradientColors,
    isPlaying: isPlayingProp
}: {
    gradientColors: string[]
    isPlaying: boolean
}) {
    const { currentTrack, isPlaying } = usePlayerStore()

    const [lyrics, setLyrics] = useState<ParsedLyrics | null>(null)
    const [isLoading, setIsLoading] = useState(false)
    const [currentTime, setCurrentTime] = useState(0)
    const [activeLine, setActiveLine] = useState(-1)
    const [isInGap, setIsInGap] = useState(false)
    const [gapProgress, setGapProgress] = useState(0)
    const [gapTimeRemaining, setGapTimeRemaining] = useState(0)
    const [isUserScrolling, setIsUserScrolling] = useState(false)
    const scrollContainerRef = useRef<HTMLDivElement>(null)
    const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null)
    const isAutoScrollingRef = useRef(false) // Flag to ignore scroll events caused by auto-scroll

    // Fetch lyrics when track changes
    useEffect(() => {
        if (!currentTrack) {
            setLyrics(null)
            setActiveLine(-1)
            return
        }

        const fetchLyrics = async () => {
            setIsLoading(true)
            try {
                const res = await fetch(`/api/lyrics/${currentTrack.id}`)
                if (res.ok) {
                    const data = await res.json()
                    setLyrics(data)
                } else {
                    setLyrics(null)
                }
            } catch (error) {
                console.error('[lyrics] Failed to fetch:', error)
                setLyrics(null)
            } finally {
                setIsLoading(false)
            }
        }

        fetchLyrics()
    }, [currentTrack?.id])

    // Listen to audio time updates
    useEffect(() => {
        const audioElement = document.querySelector('audio')
        if (!audioElement) return

        const handleTimeUpdate = () => {
            setCurrentTime(audioElement.currentTime)
        }

        audioElement.addEventListener('timeupdate', handleTimeUpdate)
        return () => audioElement.removeEventListener('timeupdate', handleTimeUpdate)
    }, [])

    // Calculate active line and gap state based on current time
    useEffect(() => {
        if (!lyrics?.synced || lyrics.lines.length === 0) return

        let newActiveLine = -1
        for (let i = lyrics.lines.length - 1; i >= 0; i--) {
            if (currentTime >= lyrics.lines[i].time) {
                newActiveLine = i
                break
            }
        }

        // Hysteresis: To prevent "flashback" flicker where activeLine jumps back deeply briefly
        // caused by timing jitter or aggressive optimization, we only allow going back
        // if we are significantly before the current line start (e.g. > 1.0s).
        // This ensures that momentary jitter doesn't un-highlight the current line.
        if (activeLine !== -1 && newActiveLine < activeLine) {
            const currentLineStartTime = lyrics.lines[activeLine].time
            if (currentTime > currentLineStartTime - 1.0) {
                newActiveLine = activeLine
            }
        }

        // Check if we're in a gap before the next line
        let inGap = false
        let progress = 0
        let timeRemaining = 0

        if (newActiveLine >= 0 && newActiveLine < lyrics.lines.length - 1) {
            const currentLine = lyrics.lines[newActiveLine]
            const nextLine = lyrics.lines[newActiveLine + 1]
            const gap = nextLine.time - currentLine.time

            if (gap >= PAUSE_THRESHOLD) {
                // Only show dots if we have endTime (TTML/SRT format)
                // LRC format doesn't have endTime so skip dots entirely
                if (!currentLine.endTime) {
                    // Skip dots for LRC format
                } else {
                    const lineEndTime = currentLine.endTime - currentLine.time
                    const timeIntoGap = currentTime - currentLine.time

                    // Calculate time remaining until next verse
                    timeRemaining = nextLine.time - currentTime

                    // Only show dots if there's enough time and current line has finished
                    if (timeIntoGap > lineEndTime && timeRemaining >= MIN_DOTS_DURATION) {
                        inGap = true
                        // Calculate progress from when dots appear to when final inhale starts
                        const dotsStartTime = lineEndTime
                        const effectiveDotsDuration = gap - dotsStartTime - FINAL_INHALE_DURATION
                        if (effectiveDotsDuration > 0) {
                            progress = Math.min(1, (timeIntoGap - dotsStartTime) / effectiveDotsDuration)
                        } else {
                            progress = 1 // Skip to fully filled if not enough time for progress
                        }
                    }
                }
            }
        }

        if (newActiveLine !== activeLine) {
            setActiveLine(newActiveLine)
        }
        setIsInGap(inGap)
        setGapProgress(progress)
        setGapTimeRemaining(timeRemaining)
    }, [currentTime, lyrics, activeLine])

    // Auto-scroll to active line - position at top third, not center
    // Only scroll if NOT in user interaction mode
    const scrollToActiveLine = useCallback(() => {
        if (activeLine < 0 || !scrollContainerRef.current) return

        const container = scrollContainerRef.current
        const activeElement = container.querySelector(`[data-line-index="${activeLine}"]`)

        if (activeElement) {
            const containerRect = container.getBoundingClientRect()
            const elementRect = activeElement.getBoundingClientRect()
            const targetOffset = 80
            const offsetTop = elementRect.top - containerRect.top - targetOffset

            // Set flag so we don't treat this as user interaction
            isAutoScrollingRef.current = true
            container.scrollTo({
                top: container.scrollTop + offsetTop,
                behavior: 'smooth'
            })

            // Reset flag after animation roughly finishes
            setTimeout(() => {
                isAutoScrollingRef.current = false
            }, 1000) // Increased to 1000ms to prevent flicker (blur returning briefly)
        }
    }, [activeLine])

    // Effect to scroll when active line changes
    useEffect(() => {
        if (!isUserScrolling) {
            scrollToActiveLine()
        }
    }, [activeLine, isUserScrolling, scrollToActiveLine])

    // Handle user scroll interaction
    const handleScroll = useCallback(() => {
        // Ignore if auto-scrolling (programmatic)
        if (isAutoScrollingRef.current) return

        setIsUserScrolling(true)

        // Clear existing timeout
        if (scrollTimeoutRef.current) {
            clearTimeout(scrollTimeoutRef.current)
        }

        // Set timeout to return to auto-following
        scrollTimeoutRef.current = setTimeout(() => {
            setIsUserScrolling(false)
            // Explicitly snap back to active line when timeout ends
            // The useEffect would do this, but explicit call ensures immediate response
            requestAnimationFrame(() => {
                scrollToActiveLine()
            })
        }, 3000)
    }, [scrollToActiveLine])

    const handleLineClick = useCallback((line: LyricsLine) => {
        const audioElement = document.querySelector('audio')
        if (audioElement && line.time !== undefined) {
            audioElement.currentTime = line.time
        }
    }, [])

    const primaryColor = gradientColors[0] || '#000000'
    const isLight = isLightColor(primaryColor)

    return (
        <>
            {/* Header - just Lyrics title */}
            <div className={cn(
                "h-14 px-4 flex items-center flex-shrink-0 border-b transition-colors duration-500",
                isLight ? "text-black border-black/10" : "text-white border-black/20"
            )}>
                <div className="flex items-center gap-2 text-base font-semibold">
                    <Mic2 className="h-4 w-4" />
                    Lyrics
                </div>
            </div>

            {/* Lyrics content */}
            <div className="flex-1 min-h-0 overflow-hidden relative flex flex-col">
                {!currentTrack ? (
                    <LyricsPlaceholder state="no-track" isLight={isLight} />
                ) : isLoading ? (
                    <LyricsPlaceholder state="loading" isLight={isLight} />
                ) : !lyrics || lyrics.lines.length === 0 ? (
                    <LyricsPlaceholder state="no-lyrics" trackTitle={currentTrack.title} isLight={isLight} />
                ) : (
                    <div
                        ref={scrollContainerRef}
                        onScroll={handleScroll}
                        className="h-full overflow-y-auto overflow-x-hidden scroll-smooth pb-32 pt-4"
                        style={{
                            maskImage: 'linear-gradient(to bottom, black 0%, black 80%, transparent)',
                            WebkitMaskImage: 'linear-gradient(to bottom, black 0%, black 80%, transparent)'
                        }}
                    >
                        <AnimatePresence mode="sync">
                            {lyrics.lines.map((line, index) => (
                                <div key={index} data-line-index={index}>
                                    <LyricsLineComponent
                                        line={line}
                                        isActive={index === activeLine && !isInGap}
                                        isPast={index < activeLine}
                                        distance={Math.abs(index - activeLine)}
                                        isUserScrolling={isUserScrolling}
                                        onClick={() => handleLineClick(line)}
                                    />
                                    {/* Show breathing dots after the active line during a gap */}
                                    {index === activeLine && isInGap && (
                                        <BreathingDots
                                            progress={gapProgress}
                                            timeRemaining={gapTimeRemaining}
                                            isPaused={!isPlaying}
                                        />
                                    )}
                                </div>
                            ))}
                        </AnimatePresence>
                        <div className="h-48" />
                    </div>
                )}
            </div>
        </>
    )
})

export function LyricsSidebar() {
    const { lyricsOpen, currentTrack, isPlaying } = usePlayerStore()
    const [gradientColors, setGradientColors] = useState<string[]>(getAppleMusicFallbackColors())

    // Extract colors from cover art when track changes
    useEffect(() => {
        if (!currentTrack) {
            setGradientColors(getAppleMusicFallbackColors())
            return
        }

        const coverUrl = `/api/cover/${currentTrack.id}?size=small`
        extractColorsFromImage(coverUrl)
            .then(colors => setGradientColors(colors))
            .catch(() => setGradientColors(getAppleMusicFallbackColors()))
    }, [currentTrack])

    return (
        <AnimatePresence mode="wait">
            {lyricsOpen && (
                <motion.aside
                    key="lyrics-sidebar"
                    initial={{ width: 0, opacity: 0 }}
                    animate={{ width: 320, opacity: 1 }}
                    exit={{ width: 0, opacity: 0 }}
                    transition={{ duration: 0.2, ease: "easeInOut" }}
                    className="flex-shrink-0 border-l overflow-hidden flex flex-col relative h-[calc(100%-80px)]"
                >
                    {/* Animated gradient background - softer like player bar */}
                    <DynamicGradientBackground
                        colors={gradientColors}
                        className="absolute inset-0 opacity-40"
                        isPaused={!isPlaying}
                    />
                    {/* Overlay for readability */}
                    <div className="absolute inset-0 bg-black/50" />
                    {/* Content */}
                    <div className="relative flex flex-col h-full">
                        <LyricsPanelContent gradientColors={gradientColors} isPlaying={isPlaying} />
                    </div>
                </motion.aside>
            )}
        </AnimatePresence>
    )
}
