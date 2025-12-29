"use client"

/**
 * Extract dominant colors from an image using Canvas API.
 * Returns an array of hex colors suitable for gradient backgrounds.
 */
export async function extractColorsFromImage(imageUrl: string): Promise<string[]> {
    return new Promise((resolve) => {
        const img = new Image()
        img.crossOrigin = "anonymous"

        let resolved = false
        const safeResolve = (colors: string[]) => {
            if (!resolved) {
                resolved = true
                resolve(colors)
            }
        }

        // Timeout fallback
        const timeout = setTimeout(() => {
            safeResolve(getAppleMusicFallbackColors())
        }, 3000)

        img.onload = () => {
            clearTimeout(timeout)
            try {
                const canvas = document.createElement("canvas")
                const ctx = canvas.getContext("2d")

                if (!ctx) {
                    safeResolve(getAppleMusicFallbackColors())
                    return
                }

                // Sample at a small size for performance
                const sampleSize = 32
                canvas.width = sampleSize
                canvas.height = sampleSize

                ctx.drawImage(img, 0, 0, sampleSize, sampleSize)
                const imageData = ctx.getImageData(0, 0, sampleSize, sampleSize)
                const pixels = imageData.data

                // Count color occurrences - use more vibrant colors
                const colorCounts: Map<string, { count: number; r: number; g: number; b: number; saturation: number }> = new Map()

                for (let i = 0; i < pixels.length; i += 4) {
                    const r = pixels[i]
                    const g = pixels[i + 1]
                    const b = pixels[i + 2]
                    const a = pixels[i + 3]

                    // Skip transparent pixels
                    if (a < 128) continue

                    // Calculate brightness and saturation
                    const max = Math.max(r, g, b)
                    const min = Math.min(r, g, b)
                    const brightness = (max + min) / 2
                    const saturation = max === 0 ? 0 : (max - min) / max

                    // Skip very dark/light pixels and low saturation
                    if (brightness < 30 || brightness > 230) continue

                    // Quantize to reduce similar colors (smaller buckets for more variety)
                    const qr = Math.round(r / 24) * 24
                    const qg = Math.round(g / 24) * 24
                    const qb = Math.round(b / 24) * 24
                    const key = `${qr},${qg},${qb}`

                    const existing = colorCounts.get(key)
                    if (existing) {
                        existing.count++
                    } else {
                        colorCounts.set(key, { count: 1, r: qr, g: qg, b: qb, saturation })
                    }
                }

                // Sort by saturation * count to prefer vibrant colors
                const sortedColors = Array.from(colorCounts.values())
                    .sort((a, b) => (b.saturation * b.count) - (a.saturation * a.count))
                    .slice(0, 4)

                if (sortedColors.length < 2) {
                    safeResolve(getAppleMusicFallbackColors())
                    return
                }

                // Convert to hex - ensure proper padding
                const colors = sortedColors.map((c) => {
                    const rHex = Math.min(255, Math.max(0, c.r)).toString(16).padStart(2, "0")
                    const gHex = Math.min(255, Math.max(0, c.g)).toString(16).padStart(2, "0")
                    const bHex = Math.min(255, Math.max(0, c.b)).toString(16).padStart(2, "0")
                    return `#${rHex}${gHex}${bHex}`
                })

                // Ensure we have at least 3 colors for nice gradients
                while (colors.length < 3) {
                    colors.push(colors[colors.length - 1])
                }

                console.log("[Color Extraction] Extracted colors:", colors)
                safeResolve(colors)
            } catch (err) {
                console.error("[Color Extraction] Error:", err)
                safeResolve(getAppleMusicFallbackColors())
            }
        }

        img.onerror = () => {
            clearTimeout(timeout)
            console.warn("[Color Extraction] Image failed to load:", imageUrl)
            safeResolve(getAppleMusicFallbackColors())
        }

        img.src = imageUrl
    })
}

/**
 * Apple Music accent color fallback palette.
 * Based on the Apple Music Red (hsl 343, 100%, 50%)
 */
export function getAppleMusicFallbackColors(): string[] {
    return [
        "#ff2d55", // Apple Music Red
        "#ff375f", // Slightly lighter red
        "#e01c47", // Darker red
        "#ff6b8a", // Light pink variant
    ]
}
