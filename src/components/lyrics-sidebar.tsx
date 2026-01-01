"use client"

import * as React from "react"
import { memo, useCallback, useEffect, useRef, useState } from "react"
import { usePlayerStore } from "@/lib/store"
import { motion, AnimatePresence } from "motion/react"
import { cn } from "@/lib/utils"
import { Mic2, MessageSquare } from "lucide-react"
import { DynamicGradientBackground } from "@/components/ui/dynamic-gradient-background"
import { extractColorsFromImage, getAppleMusicFallbackColors } from "@/lib/color-extraction"
import type { LyricsLine, LyricsWord, ParsedLyrics } from "@/lib/lyrics-parser"

// Apple Music-style breathing dots animation for instrumental pauses
// Only shown when lyrics have endTime (TTML/SRT), not for LRC format
const INHALE_DURATION = 2.0 // Fixed duration for final inhale animation (seconds)
const MIN_PAUSE_FOR_DOTS = 2.0 // Minimum pause duration to show dots at all

const BreathingDots = memo(function BreathingDots({
    breathingProgress, // 0-1 progress through breathing phase (before inhale)
    isInhaling, // Whether we're in the final inhale phase
    inhaleProgress, // 0-1 progress through inhale phase
    isPaused  // Whether playback is paused
}: {
    breathingProgress: number
    isInhaling: boolean
    inhaleProgress: number
    isPaused: boolean
}) {
    // Calculate opacity for each dot based on breathing progress (progressive fill)
    const getDotOpacity = (dotIndex: number) => {
        // Each dot fills during its third of the breathing phase
        const fillStart = dotIndex / 3
        const fillEnd = (dotIndex + 1) / 3

        if (breathingProgress <= fillStart) return 0.25 // Dim
        if (breathingProgress >= fillEnd) return 1.0 // Fully lit

        // Smooth interpolation during this dot's fill phase
        const localProgress = (breathingProgress - fillStart) / (1 / 3)
        return 0.25 + localProgress * 0.75
    }

    // Calculate scale based on phase
    // During breathing: CSS handles the animation (1 → 1.15 → 1)
    // During inhale: start from breathing peak (1.15) and grow to max, then shrink
    const getScale = () => {
        if (isPaused) return 1.0

        if (isInhaling) {
            // Inhale animation: start from breathing peak scale (1.15), grow then shrink
            // First 70%: scale up from 1.15 to 1.44 (faster grow)
            // Last 30%: scale down from 1.44 to 0 (fast shrink)
            const startScale = 1.15 // Match breathing peak
            const maxScale = 1.44 // Reduced by 10% from 1.6

            if (inhaleProgress < 0.7) {
                // Ease-in: slow start, accelerate
                const growProgress = inhaleProgress / 0.7
                const easedProgress = growProgress * growProgress // quadratic ease-in
                return startScale + easedProgress * (maxScale - startScale)
            } else {
                // Fast shrink (30% of duration)
                const shrinkProgress = (inhaleProgress - 0.7) / 0.3
                return maxScale * (1 - shrinkProgress) // → 0
            }
        }

        return 1.0 // Base scale, breathing animation handled by CSS
    }

    const scale = getScale()
    // Opacity also fades during shrink phase for smoother disappearance
    const opacity = isInhaling && inhaleProgress > 0.7 ? 1 - ((inhaleProgress - 0.7) / 0.3) : 1

    return (
        <div
            // Match text alignment: px-4 for padding, mx-2 for margin (same as lyrics lines)
            // No motion on outer div - just positioning
            className="py-2 px-4 mx-2"
        >
            {/* 
              Inner container for dots with CENTER transform origin
              This ensures the center dot stays in place during all scaling
            */}
            <motion.div
                className="flex items-center gap-[4px] w-fit"
                style={{ transformOrigin: 'center center' }}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{
                    opacity: isPaused ? 1 : opacity,
                    // Combine JS scale (for inhale) with CSS animation (for breathing)
                    scale: isPaused ? 1 : (isInhaling ? scale : [1, 1.15, 1])
                }}
                exit={{ opacity: 0, scale: 0 }}
                transition={isInhaling ? {
                    // ZERO duration for instant updates (no stepping/lag)
                    opacity: { duration: 0 },
                    scale: { duration: 0 }
                } : {
                    opacity: { duration: 0.2 },
                    scale: {
                        duration: 2.5, // Slower breathing cycle
                        repeat: Infinity,
                        ease: "easeInOut"
                    }
                }}
            >
                {[0, 1, 2].map((index) => (
                    <motion.div
                        key={index}
                        // 50% bigger: 6px → 9px
                        className="w-[9px] h-[9px] rounded-full bg-white"
                        animate={{
                            opacity: getDotOpacity(index)
                        }}
                        transition={{
                            opacity: { duration: 0.15, ease: "linear" }
                        }}
                    />
                ))}
            </motion.div>
        </div>
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
    // Inactive lines scaled down more noticeably since font-size no longer changes
    const scale = isActive ? 1 : 0.85

    // Check if this line has word-level timing
    const hasWords = line.words && line.words.length > 0

    // Render word-by-word with highlighting if active and has word timing
    const renderContent = () => {
        if (!isActive || !hasWords) {
            return <span>{line.text}</span>
        }

        // LATENCY COMPENSATION: Add 150ms to currentTime to compensate for system lag
        const compensatedTime = currentTime + 0.15

        // Helper to calculate syllable progress within a word
        const getSyllableProgress = (word: LyricsWord, time: number): { overallProgress: number, currentSyllableIdx: number, syllableProgress: number } => {
            if (!word.syllables || word.syllables.length <= 1) {
                // Simple word without syllables
                const duration = word.endTime ? word.endTime - word.time : 0.3
                const timeInto = time - word.time
                let progress = 0
                if (time >= word.time) {
                    if (word.endTime && time < word.endTime) {
                        progress = Math.min(1, timeInto / duration)
                    } else if (!word.endTime && timeInto < 0.3) {
                        progress = Math.min(1, timeInto / 0.3)
                    } else {
                        progress = 1
                    }
                }
                return { overallProgress: progress, currentSyllableIdx: 0, syllableProgress: progress }
            }

            // Compound word with syllables - calculate which syllable we're in
            const syllables = word.syllables
            const wordStart = syllables[0].time
            const wordEnd = syllables[syllables.length - 1].endTime || (syllables[syllables.length - 1].time + 0.3)
            const totalDuration = wordEnd - wordStart

            if (time < wordStart) {
                return { overallProgress: 0, currentSyllableIdx: -1, syllableProgress: 0 }
            }
            if (time >= wordEnd) {
                return { overallProgress: 1, currentSyllableIdx: syllables.length, syllableProgress: 1 }
            }

            // Find current syllable
            let completedChars = 0
            const totalChars = word.text.length

            for (let i = 0; i < syllables.length; i++) {
                const syl = syllables[i]
                const sylEnd = syl.endTime || (syllables[i + 1]?.time || (syl.time + 0.3))
                const sylChars = syl.text.length

                if (time >= syl.time && time < sylEnd) {
                    // We're in this syllable
                    const sylDuration = sylEnd - syl.time
                    const sylProgress = Math.min(1, (time - syl.time) / sylDuration)
                    const charsRevealed = completedChars + sylProgress * sylChars
                    return {
                        overallProgress: charsRevealed / totalChars,
                        currentSyllableIdx: i,
                        syllableProgress: sylProgress
                    }
                }
                completedChars += sylChars
            }

            return { overallProgress: 1, currentSyllableIdx: syllables.length, syllableProgress: 1 }
        }

        return (
            <span className="inline">
                {line.words!.map((word, idx) => {
                    const { overallProgress, currentSyllableIdx, syllableProgress } = getSyllableProgress(word, compensatedTime)

                    const isWordComplete = overallProgress >= 1
                    const isWordActive = overallProgress > 0 && overallProgress < 1

                    // Render compound word with syllables
                    if (word.syllables && word.syllables.length > 1) {
                        return (
                            <span key={idx}>
                                {word.syllables.map((syl, sylIdx) => {
                                    const isSylComplete = sylIdx < currentSyllableIdx
                                    const isSylActive = sylIdx === currentSyllableIdx
                                    const isSylUpcoming = sylIdx > currentSyllableIdx

                                    // Calculate fill percentage for this syllable
                                    const fillPercent = isSylActive
                                        ? syllableProgress * 100
                                        : isSylComplete ? 100 : 0

                                    // Dual-layer: base (visible) + overlay (bright, clipped)
                                    return (
                                        <span
                                            key={sylIdx}
                                            style={{
                                                position: 'relative',
                                                display: 'inline-block',
                                            }}
                                        >
                                            {/* Base layer: dim for upcoming/active, bright only when complete */}
                                            <span style={{
                                                color: isSylComplete ? 'white' : 'rgba(255,255,255,0.5)',
                                                filter: isSylComplete ? 'drop-shadow(0 0 3px rgba(255,255,255,0.9))' : 'none',
                                            }}>
                                                {syl.text}
                                            </span>
                                            {/* Overlay: glow + text revealed via polygon clip-path (extends left for full glow) */}
                                            {isSylActive && (
                                                <span
                                                    style={{
                                                        position: 'absolute',
                                                        left: 0,
                                                        top: 0,
                                                        color: 'white',
                                                        // Polygon extends 10px on both sides to show glow at edges
                                                        clipPath: `polygon(-10px -10px, calc(${fillPercent}% + 10px) -10px, calc(${fillPercent}% + 10px) 110%, -10px 110%)`,
                                                        filter: 'drop-shadow(0 0 3px rgba(255,255,255,0.9))',
                                                        pointerEvents: 'none',
                                                    }}
                                                >
                                                    {syl.text}
                                                </span>
                                            )}
                                        </span>
                                    )
                                })}
                                {idx < line.words!.length - 1 ? ' ' : ''}
                            </span>
                        )
                    }

                    // Simple word without syllables
                    const fillPercent = isWordActive
                        ? overallProgress * 100
                        : isWordComplete ? 100 : 0

                    return (
                        <React.Fragment key={idx}>
                            <span
                                style={{
                                    position: 'relative',
                                    display: 'inline-block',
                                }}
                            >
                                {/* Base layer: dim for active, bright only when complete */}
                                <span style={{
                                    color: isWordComplete ? 'white' : 'rgba(255,255,255,0.5)',
                                    filter: isWordComplete ? 'drop-shadow(0 0 3px rgba(255,255,255,0.9))' : 'none',
                                }}>
                                    {word.text}
                                </span>
                                {/* Overlay: glow + text via polygon clip-path (extends left for full glow) */}
                                {isWordActive && (
                                    <span
                                        style={{
                                            position: 'absolute',
                                            left: 0,
                                            top: 0,
                                            color: 'white',
                                            // Polygon extends 10px on both sides to show glow at edges
                                            clipPath: `polygon(-10px -10px, calc(${fillPercent}% + 10px) -10px, calc(${fillPercent}% + 10px) 110%, -10px 110%)`,
                                            filter: 'drop-shadow(0 0 3px rgba(255,255,255,0.9))',
                                            pointerEvents: 'none',
                                        }}
                                    >
                                        {word.text}
                                    </span>
                                )}
                            </span>
                            {idx < line.words!.length - 1 ? ' ' : ''}
                        </React.Fragment>
                    )
                })}
            </span>
        )
    }

    // Determine alignment based on singer/agent
    // v1 = main artist (left), v2 = featured artist (right), v1000 = both (left)
    const isSecondaryArtist = line.agent === 'v2'

    return (
        <div
            onClick={onClick}
            style={{
                opacity,
                // Scale inactive lines DOWN instead of scaling active UP
                // This prevents text reflow since dimensions don't change
                transform: `scale(${scale})`,
                filter: `blur(${blurAmount}px)`,
                transition: 'all 0.4s cubic-bezier(0.25, 0.1, 0.25, 1)',
                transformOrigin: isSecondaryArtist ? 'right center' : 'left center',
                textAlign: isSecondaryArtist ? 'right' : 'left',
            }}
            className={cn(
                // Proper padding for text, margin for bounding box spacing from edge
                "cursor-pointer px-4 py-2 mx-2 rounded-lg transition-colors",
                "hover:bg-white/10",
                // ALWAYS use the active text size - inactive lines are visually scaled down via transform
                // This prevents text reflow/jumping when lines become active
                "text-xl leading-relaxed font-bold",
                isActive
                    ? "text-white drop-shadow-lg"
                    : isPast
                        ? "text-white/50"
                        : "text-white/70"
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
    const [gapProgress, setGapProgress] = useState(0) // Progress through breathing phase (0-1)
    const [isInhaling, setIsInhaling] = useState(false) // Whether in final inhale phase
    const [inhaleProgress, setInhaleProgress] = useState(0) // Progress through inhale phase (0-1)
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
        // Reset scroll position immediately
        if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollTop = 0
        }
    }, [currentTrack?.id])

    // Separate effect to reset scroll when lyrics actually load
    // This handles page refresh where browser scroll restoration might override the initial reset
    useEffect(() => {
        if (lyrics && scrollContainerRef.current) {
            // Use setTimeout to ensure this runs AFTER browser scroll restoration
            const timeoutId = setTimeout(() => {
                if (scrollContainerRef.current) {
                    scrollContainerRef.current.scrollTop = 0
                }
            }, 50)
            return () => clearTimeout(timeoutId)
        }
    }, [lyrics])

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

        // Check if we're in a gap (intro, between lines, or outro)
        let inGap = false
        let breathingProg = 0
        let inhaleProg = 0
        let inhaling = false

        // Helper function to calculate dot animation state for a given pause
        const calculateDotState = (pauseStart: number, pauseEnd: number) => {
            const pauseDuration = pauseEnd - pauseStart

            // Only show dots for pauses >= MIN_PAUSE_FOR_DOTS
            if (pauseDuration < MIN_PAUSE_FOR_DOTS) return null

            const timeIntoPause = currentTime - pauseStart
            const timeRemaining = pauseEnd - currentTime

            // We're in the pause if time is between pauseStart and pauseEnd
            if (timeIntoPause >= 0 && timeRemaining > 0) {
                // Calculate breathing phase duration (total - inhale)
                const breathingDuration = Math.max(0, pauseDuration - INHALE_DURATION)

                if (breathingDuration > 0 && timeIntoPause < breathingDuration) {
                    // In breathing phase
                    return {
                        inGap: true,
                        breathingProg: timeIntoPause / breathingDuration,
                        inhaling: false,
                        inhaleProg: 0
                    }
                } else {
                    // In inhale phase
                    const timeIntoInhale = timeIntoPause - breathingDuration
                    return {
                        inGap: true,
                        breathingProg: 1,
                        inhaling: true,
                        inhaleProg: Math.min(1, timeIntoInhale / INHALE_DURATION)
                    }
                }
            }
            return null
        }

        // Check for INTRO gap (before first lyric)
        if (newActiveLine === -1 && lyrics.lines.length > 0) {
            const firstLine = lyrics.lines[0]
            // Intro from time 0 to first line start
            if (firstLine.time >= MIN_PAUSE_FOR_DOTS) {
                const state = calculateDotState(0, firstLine.time)
                if (state) {
                    inGap = state.inGap
                    breathingProg = state.breathingProg
                    inhaling = state.inhaling
                    inhaleProg = state.inhaleProg
                }
            }
        }
        // Check for gap BETWEEN lines
        else if (newActiveLine >= 0 && newActiveLine < lyrics.lines.length - 1) {
            const currentLine = lyrics.lines[newActiveLine]
            const nextLine = lyrics.lines[newActiveLine + 1]

            // Only show dots if we have endTime (TTML/SRT format, not LRC)
            if (currentLine.endTime) {
                const state = calculateDotState(currentLine.endTime, nextLine.time)
                if (state) {
                    inGap = state.inGap
                    breathingProg = state.breathingProg
                    inhaling = state.inhaling
                    inhaleProg = state.inhaleProg
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
        setGapProgress(breathingProg)
        setIsInhaling(inhaling)
        setInhaleProgress(inhaleProg)
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
                        {/* Show intro dots before first lyric */}
                        {activeLine === -1 && isInGap && (
                            <BreathingDots
                                breathingProgress={gapProgress}
                                isInhaling={isInhaling}
                                inhaleProgress={inhaleProgress}
                                isPaused={!isPlaying}
                            />
                        )}
                        {lyrics.lines.map((line, index) => (
                            <div key={index} data-line-index={index}>
                                <LyricsLineComponent
                                    line={line}
                                    isActive={index === activeLine && !isInGap}
                                    isPast={index < activeLine}
                                    distance={activeLine === -1 ? index + 1 : Math.abs(index - activeLine)}
                                    isUserScrolling={isUserScrolling}
                                    currentTime={currentTime}
                                    onClick={() => handleLineClick(line)}
                                />
                                {/* Show breathing dots after the active line during a gap */}
                                {index === activeLine && isInGap && (
                                    <BreathingDots
                                        breathingProgress={gapProgress}
                                        isInhaling={isInhaling}
                                        inhaleProgress={inhaleProgress}
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
