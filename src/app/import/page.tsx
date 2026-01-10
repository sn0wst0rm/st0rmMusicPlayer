"use client"

import { Suspense } from "react"
import { useSearchParams } from "next/navigation"
import * as React from "react"
import { usePlayerStore } from "@/lib/store"
import { ImportView } from "@/components/views/ImportView"

function ImportPageContent() {
    const { setCurrentView } = usePlayerStore()
    const searchParams = useSearchParams()
    const shouldFocusUrl = searchParams.get('focus') === 'url'
    const initialUrl = searchParams.get('url') || undefined

    // Sync view state
    React.useEffect(() => {
        setCurrentView('import')
    }, [setCurrentView])

    return <ImportView autoFocusUrl={shouldFocusUrl || !!initialUrl} initialUrl={initialUrl} />
}

export default function ImportPage() {
    return (
        <Suspense fallback={<div className="flex h-screen items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div></div>}>
            <ImportPageContent />
        </Suspense>
    )
}
