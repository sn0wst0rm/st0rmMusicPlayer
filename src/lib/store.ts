import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { Artist, Playlist } from '@/types/music'

// UUID helper with fallback for older browsers (iOS Safari)
function generateUUID(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID()
    }
    // Fallback for older browsers
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0
        const v = c === 'x' ? r : (r & 0x3 | 0x8)
        return v.toString(16)
    })
}

export interface Track {
    id: string
    title: string
    artistId: string | null
    albumId: string | null
    filePath: string
    duration: number
    artist?: {
        name: string
    }
    album?: {
        title: string
    }
}

export interface QueueItem {
    uniqueId: string
    track: Track
}

// Persistent playback history entry (like Apple Music)
export interface PlaybackHistoryEntry {
    id: string
    track: Track
    playedAt: number  // Unix timestamp
}

export interface SelectedAlbum {
    id: string
    title: string
    tracks: Track[]
    artistName: string
    // Extended metadata
    description?: string
    copyright?: string
    genre?: string
    releaseDate?: Date | string
    recordLabel?: string
}

export interface NavigationState {
    view: 'artists' | 'albums' | 'songs' | 'search' | 'playlist' | 'import'
    scrollTop?: number
    scrollIndex?: number  // For Virtuoso views
}

// Max history entries to store (prevent localStorage from growing indefinitely)
const MAX_HISTORY_ENTRIES = 500

interface PlayerState {
    currentTrack: Track | null
    isPlaying: boolean
    volume: number
    queue: QueueItem[]
    originalQueue: QueueItem[]
    sessionHistory: QueueItem[]  // Session-only history for prev/next navigation
    playbackHistory: PlaybackHistoryEntry[]  // Persistent chronological history
    isShuffling: boolean
    sidebarOpen: boolean
    queueOpen: boolean
    lyricsOpen: boolean
    searchQuery: string
    currentView: 'artists' | 'albums' | 'songs' | 'search' | 'album' | 'playlist' | 'import'
    gamdlServiceOnline: boolean
    repeatMode: 'off' | 'all' | 'one'
    library: Artist[]
    selectedAlbum: SelectedAlbum | null
    previousNavigation: NavigationState | null
    targetArtist: string | null  // Artist name to scroll to
    playlists: Playlist[]
    selectedPlaylistId: string | null
    playbackProgress: number  // Last known playback position in seconds (for resume after reload)
    // Codec switching state
    currentCodec: string | null  // Currently playing codec
    availableCodecs: string[]    // Available codecs for current track
    codecPriority: string[]      // User-defined codec priority order (highest first)

    // Actions
    setIsPlaying: (isPlaying: boolean) => void
    setVolume: (volume: number) => void
    playTrack: (track: Track, queue: Track[]) => void
    nextTrack: () => void
    prevTrack: () => void
    addToQueue: (track: Track) => void
    removeFromQueue: (uniqueId: string) => void
    playNext: (track: Track) => void
    reorderQueue: (newQueue: QueueItem[]) => void
    toggleShuffle: () => void
    setSearchQuery: (query: string) => void
    setCurrentView: (view: 'artists' | 'albums' | 'songs' | 'search' | 'album' | 'playlist' | 'import') => void
    setGamdlServiceOnline: (online: boolean) => void
    toggleRepeat: () => void
    setQueueOpen: (open: boolean) => void
    toggleQueue: () => void
    setLyricsOpen: (open: boolean) => void
    toggleLyrics: () => void
    setLibrary: (library: Artist[]) => void
    setSelectedAlbum: (album: SelectedAlbum) => void
    clearSelectedAlbum: () => void
    setPreviousNavigation: (nav: NavigationState | null) => void
    setTargetArtist: (artistName: string | null) => void
    navigateToArtist: (artistName: string) => void
    clearPlaybackHistory: () => void
    setPlaylists: (playlists: Playlist[]) => void
    setSelectedPlaylistId: (id: string | null) => void
    navigateToPlaylist: (id: string) => void
    setPlaybackProgress: (progress: number) => void
    // Codec actions
    setCurrentCodec: (codec: string) => void
    setAvailableCodecs: (codecs: string[]) => void
    setCodecPriority: (priority: string[]) => void
    fetchCodecsForTrack: (trackId: string) => Promise<void>
}

// Helper to add track to playback history
function addToPlaybackHistory(history: PlaybackHistoryEntry[], track: Track): PlaybackHistoryEntry[] {
    const entry: PlaybackHistoryEntry = {
        id: generateUUID(),
        track,
        playedAt: Date.now()
    }
    // Add to beginning (most recent first), limit size
    const newHistory = [entry, ...history].slice(0, MAX_HISTORY_ENTRIES)
    return newHistory
}

export const usePlayerStore = create<PlayerState>()(
    persist(
        (set, get) => ({
            currentTrack: null,
            isPlaying: false,
            volume: 1,
            queue: [],
            originalQueue: [],
            sessionHistory: [],  // Session-only, not persisted
            playbackHistory: [],  // Persisted
            isShuffling: false,
            sidebarOpen: true,
            queueOpen: false,
            lyricsOpen: false,
            searchQuery: "",
            currentView: 'songs',
            repeatMode: 'off',
            library: [],
            selectedAlbum: null,
            previousNavigation: null,
            targetArtist: null,
            playlists: [],
            selectedPlaylistId: null,
            gamdlServiceOnline: false,
            playbackProgress: 0,
            currentCodec: null,
            availableCodecs: [],
            // Default codec priority: prefer lossless > spatial > standard
            codecPriority: ['alac', 'atmos', 'aac-binaural', 'aac', 'aac-he', 'aac-legacy', 'aac-he-legacy', 'ac3', 'aac-downmix'],

            setIsPlaying: (isPlaying) => set({ isPlaying }),
            setVolume: (volume) => set({ volume }),
            playTrack: (track, sourceList) => {
                const state = get()
                const index = sourceList.findIndex(t => t.id === track.id)

                // Add PREVIOUS track to history (the one we're leaving), not the new one
                const newPlaybackHistory = state.currentTrack
                    ? addToPlaybackHistory(state.playbackHistory, state.currentTrack)
                    : state.playbackHistory

                if (index === -1) {
                    // Track not in source list - just play it
                    set({
                        currentTrack: track,
                        queue: [],
                        originalQueue: [],
                        sessionHistory: [],
                        playbackHistory: newPlaybackHistory,
                        isPlaying: true
                    })
                    return
                }

                // Use the track object from the source list to ensure we have full metadata
                const fullTrack = sourceList[index]

                // Only upcoming tracks go into the queue - NO fake history
                const upcomingTracks = sourceList.slice(index + 1)
                const upcomingItems: QueueItem[] = upcomingTracks.map(t => ({ uniqueId: generateUUID(), track: t }))

                set({
                    currentTrack: fullTrack,
                    sessionHistory: [],
                    playbackHistory: newPlaybackHistory,
                    queue: state.isShuffling ? [...upcomingItems].sort(() => Math.random() - 0.5) : upcomingItems,
                    originalQueue: upcomingItems,
                    isPlaying: true
                })
            },
            nextTrack: () => {
                const state = get()
                if (state.queue.length === 0) {
                    if (state.repeatMode === 'one' && state.currentTrack) {
                        // Repeat one - just restart, DON'T add duplicate to history
                        set({
                            currentTrack: { ...state.currentTrack },
                            isPlaying: true
                        })
                        return
                    }

                    if (state.repeatMode === 'all') {
                        const allItems = [...state.sessionHistory, ...(state.currentTrack ? [{ uniqueId: 'current', track: state.currentTrack }] : [])]

                        // If only one track total
                        if (allItems.length === 1 && state.currentTrack) {
                            // Single track on repeat all - just restart, don't duplicate history
                            set({
                                currentTrack: { ...state.currentTrack },
                                isPlaying: true
                            })
                            return
                        }

                        if (allItems.length > 0) {
                            const [first, ...rest] = allItems.map(item => item.track)
                            const restItems = rest.map(t => ({ uniqueId: generateUUID(), track: t }))

                            // Add current track to history before looping
                            const newPlaybackHistory = state.currentTrack
                                ? addToPlaybackHistory(state.playbackHistory, state.currentTrack)
                                : state.playbackHistory

                            set({
                                currentTrack: first,
                                queue: restItems,
                                originalQueue: get().isShuffling ? [...restItems].sort(() => Math.random() - 0.5) : restItems,
                                sessionHistory: [],
                                playbackHistory: newPlaybackHistory,
                                isPlaying: true
                            })
                            return
                        }
                    }

                    set({ isPlaying: false, currentTrack: null })
                    return
                }

                const [nextItem, ...rest] = state.queue
                const nextTrack = nextItem.track

                const uniqueId = nextItem.uniqueId
                const originalQueueIndex = state.originalQueue.findIndex(item => item.uniqueId === uniqueId)

                let newOriginalQueue = state.originalQueue
                if (originalQueueIndex !== -1) {
                    newOriginalQueue = [...state.originalQueue]
                    newOriginalQueue.splice(originalQueueIndex, 1)
                }

                // Add current track to session history for prev/next navigation
                const newSessionHistory = state.currentTrack
                    ? [...state.sessionHistory, { uniqueId: generateUUID(), track: state.currentTrack }]
                    : state.sessionHistory

                // Add CURRENT track (the one we're leaving) to playback history
                const newPlaybackHistory = state.currentTrack
                    ? addToPlaybackHistory(state.playbackHistory, state.currentTrack)
                    : state.playbackHistory

                set({
                    currentTrack: nextTrack,
                    queue: rest,
                    originalQueue: newOriginalQueue,
                    sessionHistory: newSessionHistory,
                    playbackHistory: newPlaybackHistory,
                    isPlaying: true
                })
            },
            prevTrack: () => {
                const state = get()
                if (state.sessionHistory.length === 0) return
                const previousItem = state.sessionHistory[state.sessionHistory.length - 1]
                const previousTrack = previousItem.track
                const newSessionHistory = state.sessionHistory.slice(0, -1)

                const currentTrack = state.currentTrack
                const currentItem: QueueItem | null = currentTrack ? { uniqueId: generateUUID(), track: currentTrack } : null

                const newQueue = currentItem ? [currentItem, ...state.queue] : state.queue
                const newOriginalQueue = currentItem ? [currentItem, ...state.originalQueue] : state.originalQueue

                set({
                    currentTrack: previousTrack,
                    sessionHistory: newSessionHistory,
                    // Note: we don't add to playbackHistory on prev - it's already there
                    queue: newQueue,
                    originalQueue: newOriginalQueue,
                    isPlaying: true
                })
            },
            addToQueue: (track) => set((state) => {
                const item: QueueItem = { uniqueId: generateUUID(), track }
                return {
                    queue: [...state.queue, item],
                    originalQueue: [...state.originalQueue, item]
                }
            }),
            removeFromQueue: (uniqueId) => set((state) => ({
                queue: state.queue.filter(t => t.uniqueId !== uniqueId),
                originalQueue: state.originalQueue.filter(t => t.uniqueId !== uniqueId)
            })),
            playNext: (track) => set((state) => {
                const item: QueueItem = { uniqueId: generateUUID(), track }
                const newQueue = [item, ...state.queue]
                const newOriginalQueue = [item, ...state.originalQueue]
                return {
                    queue: newQueue,
                    originalQueue: newOriginalQueue
                }
            }),
            reorderQueue: (newQueue) => set({ queue: newQueue }),
            toggleShuffle: () => set((state) => {
                if (!state.isShuffling) {
                    const currentQueue = state.queue
                    const shuffled = [...currentQueue].sort(() => Math.random() - 0.5)
                    return {
                        isShuffling: true,
                        queue: shuffled,
                        originalQueue: currentQueue
                    }
                } else {
                    return {
                        isShuffling: false,
                        queue: state.originalQueue
                    }
                }
            }),
            setSearchQuery: (query) => set({ searchQuery: query }),
            setCurrentView: (view) => set({ currentView: view }),
            toggleRepeat: () => set((state) => {
                const modes: ('off' | 'all' | 'one')[] = ['off', 'all', 'one']
                const nextIndex = (modes.indexOf(state.repeatMode) + 1) % modes.length
                return { repeatMode: modes[nextIndex] }
            }),
            setQueueOpen: (open) => set({ queueOpen: open }),
            toggleQueue: () => set((state) => ({ queueOpen: !state.queueOpen })),
            setLyricsOpen: (open) => set({ lyricsOpen: open }),
            toggleLyrics: () => set((state) => ({ lyricsOpen: !state.lyricsOpen })),
            setLibrary: (library) => set({ library }),
            setSelectedAlbum: (album) => set({ selectedAlbum: album, currentView: 'album' }),
            clearSelectedAlbum: () => set({ selectedAlbum: null }),
            setPreviousNavigation: (nav) => set({ previousNavigation: nav }),
            setTargetArtist: (artistName) => set({ targetArtist: artistName }),
            navigateToArtist: (artistName) => set({ currentView: 'artists', targetArtist: artistName, selectedAlbum: null }),
            clearPlaybackHistory: () => set({ playbackHistory: [] }),
            setPlaylists: (playlists) => set({ playlists }),
            setSelectedPlaylistId: (id) => set({ selectedPlaylistId: id }),
            setGamdlServiceOnline: (online) => set({ gamdlServiceOnline: online }),
            navigateToPlaylist: (id) => set({ currentView: 'playlist', selectedPlaylistId: id, selectedAlbum: null }),
            setPlaybackProgress: (progress) => set({ playbackProgress: progress }),
            setCurrentCodec: (codec) => set({ currentCodec: codec }),
            setAvailableCodecs: (codecs) => set({ availableCodecs: codecs }),
            setCodecPriority: (priority) => set({ codecPriority: priority }),
            fetchCodecsForTrack: async (trackId) => {
                try {
                    const res = await fetch(`/api/track/${trackId}/codecs`)
                    if (res.ok) {
                        const data = await res.json()
                        const available: string[] = data.available || []

                        // Only set availableCodecs here
                        // The player component's validation effect will select the codec
                        // (checking pre-cache first, then priority, with playability testing)
                        set({ availableCodecs: available })
                    }
                } catch (error) {
                    console.error('Failed to fetch codecs:', error)
                }
            }
        }),
        {
            name: 'storm-music-player',
            // Persist navigation and playback state for reload recovery
            partialize: (state) => ({
                // Playback history (existing)
                playbackHistory: state.playbackHistory,
                // Current playback state for resume after reload
                currentTrack: state.currentTrack,
                queue: state.queue,
                originalQueue: state.originalQueue,
                isShuffling: state.isShuffling,
                repeatMode: state.repeatMode,
                volume: state.volume,
                playbackProgress: state.playbackProgress,
                // Navigation state for URL restoration
                currentView: state.currentView,
                selectedAlbum: state.selectedAlbum,
                selectedPlaylistId: state.selectedPlaylistId,
                searchQuery: state.searchQuery,
                // Codec priority (user preference)
                codecPriority: state.codecPriority,
            }),
        }
    )
)
