import * as React from "react"
import { cn } from "@/lib/utils"

interface LetterSelectorProps extends React.HTMLAttributes<HTMLDivElement> {
    onLetterClick: (letter: string) => void
    activeLetter?: string
}

const ALPHABET = "#ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("")

export function LetterSelector({ onLetterClick, activeLetter, className, ...props }: LetterSelectorProps) {
    return (
        <div
            className={cn(
                "flex flex-col items-center justify-between h-full text-[10px] font-medium text-muted-foreground select-none",
                className
            )}
            {...props}
        >
            {ALPHABET.map((letter, i) => (
                <React.Fragment key={letter}>
                    <button
                        onClick={() => onLetterClick(letter)}
                        className={cn(
                            "transition-all w-full text-center flex-1 flex items-center justify-center leading-none",
                            activeLetter === letter ? "text-pink-500 font-bold scale-125" : "hover:text-primary"
                        )}
                    >
                        {letter}
                    </button>
                    {i < ALPHABET.length - 1 && (
                        <div className="text-[8px] leading-none opacity-50 flex-1 flex items-center justify-center select-none">•</div>
                    )}
                </React.Fragment>
            ))}
        </div>
    )
}
