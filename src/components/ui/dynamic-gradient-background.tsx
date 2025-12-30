'use client';

import * as React from 'react';
import { motion, type HTMLMotionProps } from 'motion/react';

import { cn } from '@/lib/utils';

type DynamicGradientBackgroundProps = Omit<HTMLMotionProps<'div'>, 'animate' | 'transition'> & {
    colors?: string[];
    /** Animation duration in seconds */
    duration?: number;
    /** Whether the animation is paused */
    isPaused?: boolean;
};

/**
 * Dynamic gradient background that can accept custom colors.
 * Uses CSS keyframe animation for smooth continuous movement.
 */
function DynamicGradientBackground({
    className,
    colors,
    duration = 20,
    isPaused = false,
    style,
    ...props
}: DynamicGradientBackgroundProps) {
    // Build gradient CSS from colors
    const gradientCSS = React.useMemo(() => {
        if (colors && colors.length >= 2) {
            // Create a multi-stop gradient with the provided colors, repeating first for seamless loop
            const colorStops = [...colors, colors[0]].join(', ');
            return `linear-gradient(135deg, ${colorStops})`;
        }
        return 'linear-gradient(135deg, #ff2d55, #ff375f, #e01c47, #ff6b8a, #ff2d55)';
    }, [colors]);

    return (
        <motion.div
            data-slot="dynamic-gradient-background"
            className={cn(
                'size-full',
                className,
            )}
            style={{
                backgroundImage: gradientCSS,
                backgroundSize: '300% 300%',
                ...style,
            }}
            initial={{ backgroundPosition: '0% 0%' }}
            animate={isPaused ? undefined : { backgroundPosition: ['0% 0%', '100% 100%'] }}
            transition={{
                duration: duration,
                ease: 'linear',
                repeat: Infinity,
                repeatType: 'reverse', // Move back and forth for smooth diagonal
            }}
            {...props}
        />
    );
}

export { DynamicGradientBackground, type DynamicGradientBackgroundProps };
