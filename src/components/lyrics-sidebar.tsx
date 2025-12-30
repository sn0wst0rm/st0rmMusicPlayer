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
// Uses pure CSS transitions instead of Framer Motion animate to prevent flicker
// Supports progressive word-by-word highlighting for syllable-lyrics
const LyricsLineComponent = memo(function LyricsLineComponent({
    line,
    isActive,
    isPast,
    distance,
    isUserScrolling,
    currentTime,
    onClick
}: {
    line: LyricsLine
    isActive: boolean
    isPast: boolean
    distance: number
    isUserScrolling: boolean
    currentTime: number
    onClick: () => void
}) {

    // Progressive blur: active = 0, next/prev = low blur, then increasing
    const blurAmount = isUserScrolling ? 0 : (distance === 0 ? 0 : Math.min(distance * 0.6, 3))

    // Calculate opacity based on state
    const opacity = (isActive || isUserScrolling) ? 1 : (isPast ? 0.4 : 0.6)
    const scale = isActive ? 1 : 0.95

    // Check if this line has word-level timing
    const hasWords = line.words && line.words.length > 0

    // Render word-by-word with highlighting if active and has word timing
    const renderContent = () => {
        if (!isActive || !hasWords) {
            return <span>{line.text}</span>
        }

        // Active line with word timing - highlight each word with glow
        return (
            <span className="inline">
                {line.words!.map((word, idx) => {
                    const wordDuration = word.endTime ? word.endTime - word.time : 0.3
                    const timeIntoWord = currentTime - word.time

                    // Calculate progress: 0 = not started, 1 = complete
                    let progress = 0
                    if (currentTime >= word.time) {
                        if (word.endTime && currentTime < word.endTime) {
                            progress = Math.min(1, timeIntoWord / wordDuration)
                        } else if (!word.endTime && timeIntoWord < 0.3) {
                            progress = Math.min(1, timeIntoWord / 0.3)
                        } else {
                            progress = 1
                        }
                    }

                    const isWordComplete = progress >= 1
                    const isWordActive = progress > 0 && progress < 1

                    // Simple color/glow based highlighting (no background-clip issues)
                    // Word being sung: bright white with glow
                    // Completed word: bright white, no glow
                    // Upcoming word: dimmed
                    const wordOpacity = isWordActive || isWordComplete ? 1 : 0.5
                    const glowIntensity = isWordActive ? 12 : (isWordComplete ? 4 : 0)

                    return (
                        <span
                            key={idx}
                            style={{
                                opacity: wordOpacity,
                                textShadow: glowIntensity > 0 
                                    ? `0 0 ${glowIntensity}px rgba(255,255,255,0.8)` 
                                    : 'none',
                                transition: 'opacity 0.1s ease-out, text-shadow 0.1s ease-out',
                            }}
                        >
                            {word.text}
                            {idx < line.words!.length - 1 ? ' ' : ''}
                        </span>
                    )
                })}
            </span>
        )
    }

    return (
        <div
            onClick={onClick}
            style={{
                opacity,
                transform: `scale(${scale})`,
                filter: `blur(${blurAmount}px)`,
                transition: 'all 0.4s cubic-bezier(0.25, 0.1, 0.25, 1)',
                transformOrigin: 'left center',
            }}
            className={cn(
                // Proper padding for text, margin for bounding box spacing from edge
                "cursor-pointer px-4 py-2 mx-2 rounded-lg transition-colors",
                "hover:bg-white/10",
                isActive
                    ? "text-white font-bold text-xl leading-relaxed drop-shadow-lg"
                    : isPast
                        ? "text-white/50 text-base"
                        : "text-white/70 text-base"
            )}
        >
            {renderContent()}
        </div>
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
        const activeLineRef = useRef(-1) // Internal ref to track active line without causing re-renders
        const isUserScrollingRef = useRef(false) // Ref mirror to avoid stale closures

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
            // Reset all state when track changes
            activeLineRef.current = -1
            setActiveLine(-1)
            setIsUserScrolling(false)
            isUserScrollingRef.current = false
            // Reset scroll position
            if (scrollContainerRef.current) {
                scrollContainerRef.current.scrollTop = 0
            }
        }, [currentTrack?.id])

        // High-frequency time updates using requestAnimationFrame for smooth syllable animation
        // This provides ~60fps updates instead of audio timeupdate's ~4fps (250ms intervals)
        useEffect(() => {
            const audioElement = document.querySelector('audio') as HTMLAudioElement | null
            if (!audioElement) return

            let animationId: number
            let lastTime = -1

            const updateTime = () => {
                const newTime = audioElement.currentTime
                // Only update if time actually changed (avoid unnecessary re-renders)
                if (Math.abs(newTime - lastTime) > 0.001) {
                    lastTime = newTime
                    setCurrentTime(newTime)
                }
                animationId = requestAnimationFrame(updateTime)
            }

            // Start the animation loop
            animationId = requestAnimationFrame(updateTime)

            return () => {
                cancelAnimationFrame(animationId)
            }
        }, [])

        // Calculate active line and gap state based on current time
        // CRITICAL: Do NOT include activeLine in dependencies - use ref instead to prevent cascading re-renders
        const lastLyricsRef = useRef<ParsedLyrics | null>(null)

        useEffect(() => {
            if (!lyrics?.synced || lyrics.lines.length === 0) {
                activeLineRef.current = -1
                setActiveLine(-1)
                return
            }

            // Reset activeLineRef when lyrics object changes (new song)
            if (lyrics !== lastLyricsRef.current) {
                lastLyricsRef.current = lyrics
                activeLineRef.current = -1
            }

            // Calculate the candidate active line based on current time
            let candidateLine = -1
            for (let i = lyrics.lines.length - 1; i >= 0; i--) {
                if (currentTime >= lyrics.lines[i].time) {
                    candidateLine = i
                    break
                }
            }

            // Forward-only logic using ref (not state) to prevent cascading
            const currentActiveRef = activeLineRef.current
            let newActiveLine = candidateLine

            // Only apply forward-only constraint if ref is valid for current lyrics
            if (currentActiveRef !== -1 &&
                currentActiveRef < lyrics.lines.length &&
                candidateLine < currentActiveRef) {
                // Candidate is behind the current active line
                // Only accept backward movement if it's a significant seek (> 2 seconds behind)
                const currentLineTime = lyrics.lines[currentActiveRef].time
                const seekThreshold = 2.0

                if (currentTime < currentLineTime - seekThreshold) {
                    // This is a real seek backward, accept it
                    newActiveLine = candidateLine
                } else {
                    // Small backward jitter, ignore it - keep the current line
                    newActiveLine = currentActiveRef
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
                    if (currentLine.endTime) {
                        const lineEndTime = currentLine.endTime - currentLine.time
                        const timeIntoGap = currentTime - currentLine.time
                        timeRemaining = nextLine.time - currentTime

                        if (timeIntoGap > lineEndTime && timeRemaining >= MIN_DOTS_DURATION) {
                            inGap = true
                            const dotsStartTime = lineEndTime
                            const effectiveDotsDuration = gap - dotsStartTime - FINAL_INHALE_DURATION
                            if (effectiveDotsDuration > 0) {
                                progress = Math.min(1, (timeIntoGap - dotsStartTime) / effectiveDotsDuration)
                            } else {
                                progress = 1
                            }
                        }
                    }
                }
            }

            // Only update state if the active line actually changed
            // Update ref FIRST, then state, to ensure consistency
            if (newActiveLine !== activeLineRef.current) {
                activeLineRef.current = newActiveLine
                setActiveLine(newActiveLine)
            }
            setIsInGap(inGap)
            setGapProgress(progress)
            setGapTimeRemaining(timeRemaining)
        }, [currentTime, lyrics]) // REMOVED activeLine from dependencies

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

                // Only scroll if we need to move more than a small threshold
                if (Math.abs(offsetTop) < 5) return

                // Set flag so we don't treat this as user interaction
                // Use a longer immunity period to cover the entire smooth scroll animation
                isAutoScrollingRef.current = true
                container.scrollTo({
                    top: container.scrollTop + offsetTop,
                    behavior: 'smooth'
                })

                // Reset flag after animation roughly finishes
                // Extended to 1500ms to fully cover smooth scroll duration
                setTimeout(() => {
                    isAutoScrollingRef.current = false
                }, 1500)
            }
        }, [activeLine])

        // Effect to scroll when active line changes
        useEffect(() => {
            if (!isUserScrolling) {
                scrollToActiveLine()
            }
        }, [activeLine, isUserScrolling, scrollToActiveLine])

        // Handle user scroll interaction - INSTANT detection, no debounce
        const handleScroll = useCallback(() => {
            // Ignore if auto-scrolling (programmatic)
            if (isAutoScrollingRef.current) return

            // Immediately enter user scroll mode - no debounce
            if (!isUserScrollingRef.current) {
                isUserScrollingRef.current = true
                setIsUserScrolling(true)
            }

            // Clear existing timeout for returning to auto mode
            if (scrollTimeoutRef.current) {
                clearTimeout(scrollTimeoutRef.current)
            }

            // Set timeout to return to auto-following
            scrollTimeoutRef.current = setTimeout(() => {
                isUserScrollingRef.current = false
                setIsUserScrolling(false)
                // Explicitly snap back to active line when timeout ends
                requestAnimationFrame(() => {
                    // Use activeLineRef to get current value without stale closure
                    if (activeLineRef.current >= 0 && scrollContainerRef.current) {
                        const container = scrollContainerRef.current
                        const activeElement = container.querySelector(`[data-line-index="${activeLineRef.current}"]`)
                        if (activeElement) {
                            const containerRect = container.getBoundingClientRect()
                            const elementRect = activeElement.getBoundingClientRect()
                            const targetOffset = 80
                            const offsetTop = elementRect.top - containerRect.top - targetOffset
                            if (Math.abs(offsetTop) >= 5) {
                                isAutoScrollingRef.current = true
                                container.scrollTo({
                                    top: container.scrollTop + offsetTop,
                                    behavior: 'smooth'
                                })
                                setTimeout(() => {
                                    isAutoScrollingRef.current = false
                                }, 1500)
                            }
                        }
                    }
                })
            }, 3000)
        }, [])

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
                            {lyrics.lines.map((line, index) => (
                                <div key={index} data-line-index={index}>
                                    <LyricsLineComponent
                                        line={line}
                                        isActive={index === activeLine && !isInGap}
                                        isPast={index < activeLine}
                                        distance={Math.abs(index - activeLine)}
                                        isUserScrolling={isUserScrolling}
                                        currentTime={currentTime}
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
