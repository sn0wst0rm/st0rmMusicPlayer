import { create } from 'zustand'

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

interface PlayerState {
    currentTrack: Track | null
    isPlaying: boolean
    volume: number
    queue: QueueItem[]
    originalQueue: QueueItem[]
    history: QueueItem[]
    isShuffling: boolean
    sidebarOpen: boolean
    queueOpen: boolean
    searchQuery: string
    currentView: 'artists' | 'albums' | 'songs'
    repeatMode: 'off' | 'all' | 'one'

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
    setCurrentView: (view: 'artists' | 'albums' | 'songs') => void
    toggleRepeat: () => void
    setQueueOpen: (open: boolean) => void
    toggleQueue: () => void
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
    currentTrack: null,
    isPlaying: false,
    volume: 1,
    queue: [],
    originalQueue: [],
    history: [],
    isShuffling: false,
    sidebarOpen: true,
    queueOpen: false, // Initial state
    searchQuery: "",
    currentView: 'songs',
    repeatMode: 'off',

    setIsPlaying: (isPlaying) => set({ isPlaying }),
    setVolume: (volume) => set({ volume }),
    playTrack: (track, sourceList) => {
        const state = get()
        // sourceList is still Track[]
        const index = sourceList.findIndex(t => t.id === track.id)

        if (index === -1) {
            set({
                currentTrack: track,
                queue: [],
                originalQueue: [],
                history: [],
                isPlaying: true
            })
            return
        }

        // Use the track object from the source list to ensure we have full metadata
        // (The passed 'track' arg might be a partial object from a click event)
        const fullTrack = sourceList[index]

        // We need to convert sourceList tracks to QueueItems for history and upcoming
        // Note: For history, we might just want to store what was actually played. 
        // But here we are bulk setting from a list context.
        // Let's generate unique IDs for everything.

        const historyTracks = sourceList.slice(0, index)
        const upcomingTracks = sourceList.slice(index + 1)

        const historyItems: QueueItem[] = historyTracks.map(t => ({ uniqueId: crypto.randomUUID(), track: t }))
        const upcomingItems: QueueItem[] = upcomingTracks.map(t => ({ uniqueId: crypto.randomUUID(), track: t }))

        set({
            currentTrack: fullTrack,
            history: historyItems,
            queue: state.isShuffling ? [...upcomingItems].sort(() => Math.random() - 0.5) : upcomingItems,
            originalQueue: upcomingItems,
            isPlaying: true
        })
    },
    nextTrack: () => {
        const state = get()
        if (state.queue.length === 0) {
            if (state.repeatMode === 'one' && state.currentTrack) {
                set({
                    currentTrack: { ...state.currentTrack },
                    isPlaying: true
                })
                return
            }

            if (state.repeatMode === 'all') {
                const allItems = [...state.history, ...(state.currentTrack ? [{ uniqueId: 'current', track: state.currentTrack }] : [])]

                // If only one track total
                if (allItems.length === 1 && state.currentTrack) {
                    set({
                        currentTrack: { ...state.currentTrack },
                        isPlaying: true
                    })
                    return
                }

                if (allItems.length > 0) {
                    // In Repeat All, we "reset". 
                    // We take all history + current, and treat them as the new queue.
                    // But strictly speaking, "Repeat All" usually means "wrap around to original context".
                    // Ideally we used originalQueue, but originalQueue gets consumed?
                    // Let's just wrap history + current back into queue.
                    const [first, ...rest] = allItems.map(item => item.track) // Extract tracks to re-wrap with new IDs

                    // Helper to wrap
                    const restItems = rest.map(t => ({ uniqueId: crypto.randomUUID(), track: t }))

                    set({
                        currentTrack: first,
                        queue: restItems,
                        originalQueue: get().isShuffling ? [...restItems].sort(() => Math.random() - 0.5) : restItems,
                        history: [],
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

        const nextId = nextTrack.id // Track ID
        // Remove from originalQueue. We find the first occurrence of this TRACK ID? 
        // Or should strictly match uniqueId if meaningful?
        // originalQueue stores QueueItems. 
        // If we are playing from queue, we should find the corresponding item in originalQueue.
        // But if shuffled, the nextItem is from shuffled queue. Its uniqueId might be in originalQueue.

        const uniqueId = nextItem.uniqueId
        const originalQueueIndex = state.originalQueue.findIndex(item => item.uniqueId === uniqueId)

        let newOriginalQueue = state.originalQueue
        if (originalQueueIndex !== -1) {
            newOriginalQueue = [...state.originalQueue]
            newOriginalQueue.splice(originalQueueIndex, 1)
        }

        set({
            currentTrack: nextTrack,
            queue: rest,
            originalQueue: newOriginalQueue,
            history: state.currentTrack ? [...state.history, { uniqueId: crypto.randomUUID(), track: state.currentTrack }] : state.history,
            isPlaying: true
        })
    },
    prevTrack: () => {
        const state = get()
        if (state.history.length === 0) return
        const previousItem = state.history[state.history.length - 1]
        const previousTrack = previousItem.track
        const newHistory = state.history.slice(0, -1)

        const currentTrack = state.currentTrack
        const currentItem: QueueItem | null = currentTrack ? { uniqueId: crypto.randomUUID(), track: currentTrack } : null

        const newQueue = currentItem ? [currentItem, ...state.queue] : state.queue
        const newOriginalQueue = currentItem ? [currentItem, ...state.originalQueue] : state.originalQueue

        set({
            currentTrack: previousTrack,
            history: newHistory,
            queue: newQueue,
            originalQueue: newOriginalQueue,
            isPlaying: true
        })
    },
    addToQueue: (track) => set((state) => {
        const item: QueueItem = { uniqueId: crypto.randomUUID(), track }
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
        const item: QueueItem = { uniqueId: crypto.randomUUID(), track }
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
    toggleQueue: () => set((state) => ({ queueOpen: !state.queueOpen }))
}))
