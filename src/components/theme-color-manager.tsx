"use client"

import * as React from "react"
import { useTheme } from "next-themes"

export function ThemeColorManager() {
    const { resolvedTheme } = useTheme()

    React.useEffect(() => {
        const metaThemeColor = document.querySelector('meta[name="theme-color"]')
        if (metaThemeColor) {
            metaThemeColor.setAttribute(
                "content",
                resolvedTheme === "dark" ? "#0a0a0a" : "#ffffff"
            )
        }
    }, [resolvedTheme])

    return null
}
