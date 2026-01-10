import { Track } from "@/lib/store"

export interface Album {
    id: string
    title: string
    tracks: Track[]
    // Extended metadata
    description?: string | null
    copyright?: string | null
    genre?: string | null
    releaseDate?: Date | string | null
    recordLabel?: string | null
    animatedCoverPath?: string | null
}

export interface Artist {
    id: string
    name: string
    appleMusicId?: string
    albums: Album[]
    // Extended metadata
    artworkUrl?: string | null
    bio?: string | null
    genre?: string | null
    origin?: string | null
    birthDate?: string | null
    // Hero media paths (served via /api/artist-hero)
    heroAnimatedPath?: string | null
    heroStaticPath?: string | null
    profileImagePath?: string | null
}

export interface Playlist {
    id: string
    name: string
    description?: string
    coverPath?: string
    trackCount: number
    coverTracks?: { id: string; albumId: string }[]
    isSynced?: boolean  // If true, playlist is synced from Apple Music and read-only
    appleMusicId?: string  // Apple Music playlist ID
    artworkUrl?: string  // Apple Music artwork URL
}

export interface PlaylistTrackItem {
    id: string
    position: number
    addedAt: string
    track: Track
}

export interface PlaylistDetail extends Playlist {
    tracks: PlaylistTrackItem[]
}

