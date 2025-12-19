/**
 * Advanced Search Engine for Music Library
 * 
 * Features:
 * - Fuzzy matching with Levenshtein distance for typo tolerance
 * - Word boundary detection for prioritizing exact word matches
 * - Multi-factor scoring system for relevance ranking
 * - Field weighting (title > artist > album)
 */

import { Track } from "./store"
import { Artist, Album } from "@/types/music"

// ========================
// Types & Interfaces
// ========================

export type MatchType = 'exact' | 'word' | 'prefix' | 'substring' | 'fuzzy' | 'none'

export interface SearchResult<T> {
    item: T
    score: number
    matchType: MatchType
    matchedField: string
}

export interface SongSearchResult extends SearchResult<Track> {
    item: Track & { artist: { name: string }, album: { title: string } }
}

export interface AlbumSearchResult extends SearchResult<Album & { artistName: string }> { }

export interface ArtistSearchResult extends SearchResult<Artist> { }

export interface SearchResults {
    songs: SongSearchResult[]
    albums: AlbumSearchResult[]
    artists: ArtistSearchResult[]
}

// ========================
// Configuration
// ========================

const SCORE_CONFIG = {
    exact: 100,
    word: 80,
    prefix: 60,
    substring: 40,
    fuzzy1: 25,  // 1 edit distance
    fuzzy2: 15,  // 2 edit distance
    none: 0
} as const

const FIELD_WEIGHTS = {
    title: 1.0,
    artist: 0.9,
    album: 0.8
} as const

// Minimum query length for fuzzy matching (avoid too many false positives)
const MIN_FUZZY_LENGTH = 3

// Maximum edit distance for fuzzy matching (scales with query length)
const getMaxEditDistance = (queryLength: number): number => {
    if (queryLength < 4) return 0  // No fuzzy for very short queries
    if (queryLength < 7) return 1  // 1 typo tolerance for medium queries
    return 2  // 2 typo tolerance for longer queries
}

// ========================
// Core Algorithms
// ========================

/**
 * Calculate Levenshtein (edit) distance between two strings.
 * This measures the minimum number of single-character edits needed
 * to transform one string into the other.
 */
export function levenshteinDistance(a: string, b: string): number {
    // Early exit for identical strings
    if (a === b) return 0

    // Early exit for empty strings
    if (a.length === 0) return b.length
    if (b.length === 0) return a.length

    // Use two-row optimization for space efficiency
    let prevRow = Array.from({ length: b.length + 1 }, (_, i) => i)
    let currRow = new Array<number>(b.length + 1)

    for (let i = 1; i <= a.length; i++) {
        currRow[0] = i

        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1
            currRow[j] = Math.min(
                currRow[j - 1] + 1,      // insertion
                prevRow[j] + 1,          // deletion
                prevRow[j - 1] + cost    // substitution
            )
        }

        // Swap rows
        [prevRow, currRow] = [currRow, prevRow]
    }

    return prevRow[b.length]
}

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Determine the type of match between query and text
 */
export function getMatchType(query: string, text: string): MatchType {
    const q = query.toLowerCase().trim()
    const t = text.toLowerCase()

    if (!q || !t) return 'none'

    // Exact match (full string)
    if (t === q) return 'exact'

    // Word boundary match - query matches a complete word in text
    try {
        const wordBoundaryRegex = new RegExp(`\\b${escapeRegex(q)}\\b`, 'i')
        if (wordBoundaryRegex.test(t)) return 'word'
    } catch {
        // Fallback if regex fails
    }

    // Prefix match - a word in text starts with query
    try {
        const prefixRegex = new RegExp(`\\b${escapeRegex(q)}`, 'i')
        if (prefixRegex.test(t)) return 'prefix'
    } catch {
        // Fallback if regex fails
    }

    // Substring match - query appears anywhere in text
    if (t.includes(q)) return 'substring'

    // Fuzzy match - only for queries above minimum length
    if (q.length >= MIN_FUZZY_LENGTH) {
        const maxDist = getMaxEditDistance(q.length)

        // Check fuzzy against the full text for short texts
        if (t.length <= q.length + maxDist * 2) {
            const dist = levenshteinDistance(q, t)
            if (dist <= maxDist) return 'fuzzy'
        }

        // Check fuzzy against individual words in the text
        const words = t.split(/\s+/)
        for (const word of words) {
            // Only compare words of similar length
            if (Math.abs(word.length - q.length) <= maxDist) {
                const dist = levenshteinDistance(q, word)
                if (dist <= maxDist) return 'fuzzy'
            }
        }
    }

    return 'none'
}

/**
 * Calculate score for a match
 */
export function calculateScore(matchType: MatchType, query: string, text: string): number {
    switch (matchType) {
        case 'exact':
            return SCORE_CONFIG.exact
        case 'word':
            return SCORE_CONFIG.word
        case 'prefix':
            return SCORE_CONFIG.prefix
        case 'substring':
            // Bonus for substring appearing earlier in text
            const pos = text.toLowerCase().indexOf(query.toLowerCase())
            const posBonus = Math.max(0, 10 - pos) // Up to 10 bonus points for early match
            return SCORE_CONFIG.substring + posBonus
        case 'fuzzy':
            // Score based on edit distance
            const dist = levenshteinDistance(query.toLowerCase(), text.toLowerCase())
            return dist === 1 ? SCORE_CONFIG.fuzzy1 : SCORE_CONFIG.fuzzy2
        default:
            return SCORE_CONFIG.none
    }
}

// ========================
// Main Search Functions
// ========================

/**
 * Search a single field and return score
 */
function searchField(query: string, text: string, weight: number): { score: number; matchType: MatchType } {
    const matchType = getMatchType(query, text)
    const baseScore = calculateScore(matchType, query, text)
    return {
        score: baseScore * weight,
        matchType
    }
}

/**
 * Search a track and return the best match result
 */
function searchTrack(
    query: string,
    track: Track,
    artistName: string,
    albumTitle: string
): SongSearchResult | null {
    let bestScore = 0
    let bestMatchType: MatchType = 'none'
    let bestField = ''

    // Search title
    const titleResult = searchField(query, track.title, FIELD_WEIGHTS.title)
    if (titleResult.score > bestScore) {
        bestScore = titleResult.score
        bestMatchType = titleResult.matchType
        bestField = 'title'
    }

    // Search artist
    const artistResult = searchField(query, artistName, FIELD_WEIGHTS.artist)
    if (artistResult.score > bestScore) {
        bestScore = artistResult.score
        bestMatchType = artistResult.matchType
        bestField = 'artist'
    }

    // Search album
    const albumResult = searchField(query, albumTitle, FIELD_WEIGHTS.album)
    if (albumResult.score > bestScore) {
        bestScore = albumResult.score
        bestMatchType = albumResult.matchType
        bestField = 'album'
    }

    if (bestScore === 0) return null

    return {
        item: {
            ...track,
            artist: { name: artistName },
            album: { title: albumTitle }
        },
        score: bestScore,
        matchType: bestMatchType,
        matchedField: bestField
    }
}

/**
 * Search an album and return the match result
 */
function searchAlbum(
    query: string,
    album: Album,
    artistName: string
): AlbumSearchResult | null {
    let bestScore = 0
    let bestMatchType: MatchType = 'none'
    let bestField = ''

    // Search album title
    const titleResult = searchField(query, album.title, FIELD_WEIGHTS.title)
    if (titleResult.score > bestScore) {
        bestScore = titleResult.score
        bestMatchType = titleResult.matchType
        bestField = 'title'
    }

    // Search artist name for album
    const artistResult = searchField(query, artistName, FIELD_WEIGHTS.artist)
    if (artistResult.score > bestScore) {
        bestScore = artistResult.score
        bestMatchType = artistResult.matchType
        bestField = 'artist'
    }

    if (bestScore === 0) return null

    return {
        item: { ...album, artistName },
        score: bestScore,
        matchType: bestMatchType,
        matchedField: bestField
    }
}

/**
 * Search an artist and return the match result
 */
function searchArtist(query: string, artist: Artist): ArtistSearchResult | null {
    const result = searchField(query, artist.name, FIELD_WEIGHTS.title)

    if (result.score === 0) return null

    return {
        item: artist,
        score: result.score,
        matchType: result.matchType,
        matchedField: 'name'
    }
}

/**
 * Main search function - searches the entire library
 */
export function searchLibrary(query: string, library: Artist[]): SearchResults {
    const trimmedQuery = query.trim()

    // Return empty results for very short queries
    if (!trimmedQuery || trimmedQuery.length < 1) {
        return { songs: [], albums: [], artists: [] }
    }

    const songResults: SongSearchResult[] = []
    const albumResults: AlbumSearchResult[] = []
    const artistResults: ArtistSearchResult[] = []

    // Track seen albums to avoid duplicates
    const seenAlbumIds = new Set<string>()

    for (const artist of library) {
        // Search artist
        const artistResult = searchArtist(trimmedQuery, artist)
        if (artistResult) {
            artistResults.push(artistResult)
        }

        for (const album of artist.albums) {
            // Search album (avoid duplicates)
            if (!seenAlbumIds.has(album.id)) {
                const albumResult = searchAlbum(trimmedQuery, album, artist.name)
                if (albumResult) {
                    albumResults.push(albumResult)
                    seenAlbumIds.add(album.id)
                }
            }

            // Search tracks
            for (const track of album.tracks) {
                const trackResult = searchTrack(trimmedQuery, track, artist.name, album.title)
                if (trackResult) {
                    songResults.push(trackResult)
                }
            }
        }
    }

    // Sort all results by score (descending)
    songResults.sort((a, b) => b.score - a.score)
    albumResults.sort((a, b) => b.score - a.score)
    artistResults.sort((a, b) => b.score - a.score)

    return {
        songs: songResults,
        albums: albumResults,
        artists: artistResults
    }
}

/**
 * Search library with limited results (for sidebar popover)
 */
export function searchLibraryLimited(
    query: string,
    library: Artist[],
    limits: { songs?: number; albums?: number; artists?: number } = {}
): SearchResults {
    const { songs: songLimit = 3, albums: albumLimit = 3, artists: artistLimit = 3 } = limits

    const results = searchLibrary(query, library)

    return {
        songs: results.songs.slice(0, songLimit),
        albums: results.albums.slice(0, albumLimit),
        artists: results.artists.slice(0, artistLimit)
    }
}
