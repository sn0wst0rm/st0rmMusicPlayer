"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

interface MarqueeTextProps extends React.HTMLAttributes<HTMLDivElement> {
    /** The text to display */
    text: string
    /** Animation duration in seconds (for one direction) */
    duration?: number
    /** Delay before animation starts (ms) */
    delay?: number
    /** Whether to animate continuously or only on hover */
    animateOnHover?: boolean
    /** Whether to always animate (useful for player) */
    alwaysAnimate?: boolean
}

export function MarqueeText({
    text,
    duration = 3,
    delay = 300,
    animateOnHover = true,
    alwaysAnimate = false,
    className,
    ...props
}: MarqueeTextProps) {
    const containerRef = React.useRef<HTMLDivElement>(null)
    const textRef = React.useRef<HTMLSpanElement>(null)
    const [isOverflowing, setIsOverflowing] = React.useState(false)
    const [isHovering, setIsHovering] = React.useState(false)
    const [overflowAmount, setOverflowAmount] = React.useState(0)

    // Check if text overflows container
    React.useEffect(() => {
        const checkOverflow = () => {
            if (containerRef.current && textRef.current) {
                const containerWidth = containerRef.current.offsetWidth
                const textWidth = textRef.current.scrollWidth
                const overflow = textWidth - containerWidth
                setIsOverflowing(overflow > 0)
                setOverflowAmount(overflow > 0 ? overflow + 16 : 0) // Add padding
            }
        }

        checkOverflow()

        // Use ResizeObserver for responsive detection
        const resizeObserver = new ResizeObserver(checkOverflow)
        if (containerRef.current) {
            resizeObserver.observe(containerRef.current)
        }

        return () => resizeObserver.disconnect()
    }, [text])

    const shouldAnimate = isOverflowing && (alwaysAnimate || (animateOnHover && isHovering))

    // Calculate dynamic duration based on overflow amount (~30px per second)
    const animationDuration = Math.max(duration, overflowAmount / 30)

    return (
        <div
            ref={containerRef}
            className={cn("overflow-hidden relative", className)}
            onMouseEnter={() => setIsHovering(true)}
            onMouseLeave={() => setIsHovering(false)}
            {...props}
        >
            <span
                ref={textRef}
                className="inline-block whitespace-nowrap"
                style={{
                    transform: shouldAnimate ? `translateX(-${overflowAmount}px)` : 'translateX(0)',
                    transition: shouldAnimate
                        ? `transform ${animationDuration}s linear ${delay}ms`
                        : 'transform 0.3s ease-out',
                    // Use mask to fade text at the edge when not animating
                    ...(isOverflowing && !shouldAnimate ? {
                        maskImage: 'linear-gradient(to right, black 80%, transparent 100%)',
                        WebkitMaskImage: 'linear-gradient(to right, black 80%, transparent 100%)',
                    } : {}),
                }}
            >
                {text}
            </span>
        </div>
    )
}
