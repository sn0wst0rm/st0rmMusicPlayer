"use client"

import * as React from "react"
import { usePlayerStore } from "@/lib/store"
import { ImportView } from "@/components/views/ImportView"

export default function ImportPage() {
    const { setCurrentView } = usePlayerStore()

    // Sync view state
    React.useEffect(() => {
        setCurrentView('import')
    }, [setCurrentView])

    return <ImportView />
}
