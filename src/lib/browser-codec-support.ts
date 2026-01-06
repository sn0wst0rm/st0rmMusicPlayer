/**
 * Browser Codec Compatibility Table
 * 
 * This is a human-editable configuration file that defines which audio codecs
 * are supported by different browsers. Update this table based on your testing.
 * 
 * The runtime detection (canPlayType) is not always reliable, so this table
 * provides a fallback/override mechanism.
 * 
 * Format:
 * - Each entry maps a browser identifier to its supported codecs
 * - Browser is detected from navigator.userAgent
 * - Set to true if codec works, false if it doesn't
 * - null or undefined = use canPlayType detection
 */

export interface BrowserCodecSupport {
    // Codec name -> true (works), false (doesn't work), null (use detection)
    [codec: string]: boolean | null
}

export interface BrowserCompatibilityTable {
    [browserKey: string]: BrowserCodecSupport
}

/**
 * Human-editable table of browser codec compatibility.
 * 
 * Browser keys are matched against navigator.userAgent (case-insensitive substring match).
 * More specific matches take priority (e.g., "Safari" before "WebKit").
 * 
 * Tested codecs:
 * - aac-legacy: AAC 256kbps (44.1kHz) - Most compatible
 * - aac-he-legacy: AAC-HE 64kbps - Low bitrate
 * - aac: AAC (48kHz)
 * - aac-he: AAC-HE (48kHz)
 * - alac: Lossless ALAC - Apple only
 * - atmos: Dolby Atmos (EC-3/AC-3)
 * - aac-binaural: Spatial Audio (binaural AAC)
 * - aac-downmix: Stereo downmix from surround
 * - ac3: AC3 surround
 */
export const BROWSER_CODEC_COMPATIBILITY: BrowserCompatibilityTable = {
    // Safari (macOS & iOS) - Best Apple Music compatibility
    'Safari': {
        'aac-legacy': true,
        'aac-he-legacy': true,
        'aac': true,
        'aac-he': true,
        'alac': true,           // ✅ ALAC works in Safari
        'atmos': true,          // ✅ Dolby Atmos works in Safari
        'aac-binaural': true,
        'aac-he-binaural': true,
        'aac-downmix': true,
        'aac-he-downmix': true,
        'ac3': true,
    },

    // Chrome/Chromium
    'Chrome': {
        'aac-legacy': true,
        'aac-he-legacy': true,
        'aac': true,
        'aac-he': true,
        'alac': false,          // ❌ ALAC does NOT work in Chrome
        'atmos': false,         // ❌ Dolby Atmos does NOT work in Chrome
        'aac-binaural': true,
        'aac-he-binaural': true,
        'aac-downmix': true,
        'aac-he-downmix': true,
        'ac3': false,           // ❌ AC3 does NOT work in Chrome
    },

    // Firefox
    'Firefox': {
        'aac-legacy': true,
        'aac-he-legacy': true,
        'aac': true,
        'aac-he': true,
        'alac': false,          // ❌ ALAC does NOT work in Firefox
        'atmos': false,         // ❌ Dolby Atmos does NOT work in Firefox
        'aac-binaural': true,
        'aac-he-binaural': true,
        'aac-downmix': true,
        'aac-he-downmix': true,
        'ac3': true,
    },

    // Edge (Chromium-based)
    'Edg': {
        'aac-legacy': true,
        'aac-he-legacy': true,
        'aac': true,
        'aac-he': true,
        'alac': false,          // ❌ ALAC does NOT work in Edge
        'atmos': false,         // ❌ Dolby Atmos does NOT work in Edge
        'aac-binaural': true,
        'aac-he-binaural': true,
        'aac-downmix': true,
        'aac-he-downmix': true,
        'ac3': false,
    },

    // Opera (Chromium-based)
    'Opera': {
        'aac-legacy': true,
        'aac-he-legacy': true,
        'aac': true,
        'aac-he': true,
        'alac': false,
        'atmos': false,
        'aac-binaural': true,
        'aac-he-binaural': true,
        'aac-downmix': true,
        'aac-he-downmix': true,
        'ac3': false,
    },

    // Brave (Chromium-based)
    'Brave': {
        'aac-legacy': true,
        'aac-he-legacy': true,
        'aac': true,
        'aac-he': true,
        'alac': false,
        'atmos': false,
        'aac-binaural': true,
        'aac-he-binaural': true,
        'aac-downmix': true,
        'aac-he-downmix': true,
        'ac3': false,
    },
}

/**
 * Detect which browser we're running in.
 * Returns the best matching browser key from the table.
 */
export function detectBrowser(): string | null {
    if (typeof navigator === 'undefined') return null

    const ua = navigator.userAgent

    // Check in order of specificity (most specific first)
    const browserOrder = ['Brave', 'Edg', 'Opera', 'Chrome', 'Firefox', 'Safari']

    for (const browser of browserOrder) {
        if (ua.includes(browser)) {
            return browser
        }
    }

    return null
}

/**
 * Check if a codec is supported in the current browser.
 * First checks the hardcoded table, falls back to canPlayType detection.
 */
export function isCodecSupportedInBrowser(codec: string): boolean {
    if (typeof window === 'undefined') return true // SSR

    const browser = detectBrowser()

    // Check hardcoded table first
    if (browser && BROWSER_CODEC_COMPATIBILITY[browser]) {
        const support = BROWSER_CODEC_COMPATIBILITY[browser][codec]
        if (support !== null && support !== undefined) {
            return support
        }
    }

    // Fall back to canPlayType detection
    const audio = document.createElement('audio')
    const mimeTypes: Record<string, string[]> = {
        'aac-legacy': ['audio/mp4; codecs="mp4a.40.2"'],
        'aac-he-legacy': ['audio/mp4; codecs="mp4a.40.5"'],
        'aac': ['audio/mp4; codecs="mp4a.40.2"'],
        'aac-he': ['audio/mp4; codecs="mp4a.40.5"'],
        'alac': ['audio/mp4; codecs="alac"', 'audio/x-m4a'],
        'atmos': ['audio/mp4; codecs="ec-3"', 'audio/mp4; codecs="ac-3"'],
        'aac-binaural': ['audio/mp4; codecs="mp4a.40.2"'],
        'aac-he-binaural': ['audio/mp4; codecs="mp4a.40.5"'],
        'aac-downmix': ['audio/mp4; codecs="mp4a.40.2"'],
        'aac-he-downmix': ['audio/mp4; codecs="mp4a.40.5"'],
        'ac3': ['audio/mp4; codecs="ac-3"', 'audio/ac3'],
    }

    const codeMimes = mimeTypes[codec] || ['audio/mp4']

    for (const mime of codeMimes) {
        const canPlay = audio.canPlayType(mime)
        if (canPlay === 'probably' || canPlay === 'maybe') {
            return true
        }
    }

    return false
}

/**
 * Get the current browser name for display purposes.
 */
export function getBrowserName(): string {
    const browser = detectBrowser()

    const displayNames: Record<string, string> = {
        'Safari': 'Safari',
        'Chrome': 'Chrome',
        'Firefox': 'Firefox',
        'Edg': 'Edge',
        'Opera': 'Opera',
        'Brave': 'Brave',
    }

    return browser ? displayNames[browser] || browser : 'Unknown Browser'
}
