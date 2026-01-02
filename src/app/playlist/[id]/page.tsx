"use client"

import * as React from "react"
import { useParams, useRouter } from "next/navigation"
import { usePlayerStore } from "@/lib/store"
import { PlaylistView } from "@/components/views/PlaylistView"

export default function PlaylistPage() {
    const params = useParams()
    const router = useRouter()
    const playlistId = params.id as string

    const { setCurrentView, setSelectedPlaylistId } = usePlayerStore()

    // Sync view and playlist state
    React.useEffect(() => {
        setCurrentView('playlist')
        setSelectedPlaylistId(playlistId)
    }, [setCurrentView, setSelectedPlaylistId, playlistId])

    const handleBack = () => {
        setSelectedPlaylistId(null)
        router.back()
    }

    return (
        <PlaylistView
            playlistId={playlistId}
            onBack={handleBack}
        />
    )
}
