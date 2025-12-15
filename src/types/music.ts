import { Track } from "@/lib/store"

export interface Album {
    id: string
    title: string
    tracks: Track[]
}

export interface Artist {
    id: string
    name: string
    albums: Album[]
}
