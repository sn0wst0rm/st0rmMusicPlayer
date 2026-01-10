"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Download, Loader2, Play, Shuffle } from "lucide-react"
import { cn } from "@/lib/utils"
import { Album, Artist } from "@/types/music"

export interface ArtistAlbumItem {
    apple_music_id: string
    title: string
    artwork_url?: string
    release_date?: string
    track_count?: number
    is_single: boolean
}

export interface ArtistData {
    apple_music_id: string
    name: string
    artwork_url?: string
    bio?: string
    genre?: string
    origin?: string
    birth_date?: string
    url?: string
    albums: ArtistAlbumItem[]
    singles: ArtistAlbumItem[]
    storefront: string
    // Extended metadata
    is_group?: boolean
    plain_editorial_notes?: string
    // Hero media URLs
    hero_video_url?: string
    hero_static_url?: string
    profile_video_url?: string
}

interface ArtistDetailViewProps {
    artistData: ArtistData | null
    localArtist: Artist | null
    cookiesConfigured: boolean
    fetchingMetadata?: boolean
    onAlbumClick: (album: Album) => void
    onImportAlbum: (appleAlbumId: string, storefront: string) => void
    onPlayAll: () => void
    onShuffle: () => void
}

// Local album card component
function LocalAlbumCard({
    album,
    onClick
}: {
    album: Album
    onClick: () => void
}) {
    const [isLoading, setIsLoading] = React.useState(true)

    return (
        <Card
            className="group overflow-hidden border-none shadow-none bg-transparent hover:bg-card/40 transition-colors cursor-pointer"
            onClick={onClick}
        >
            <div className="aspect-square bg-secondary rounded-md mb-3 relative overflow-hidden shadow-sm group-hover:shadow-md transition-all">
                {isLoading && (
                    <Skeleton className="absolute inset-0 w-full h-full bg-primary/10" />
                )}
                <img
                    src={album.tracks[0] ? `/api/cover/${album.tracks[0].id}?size=medium` : ""}
                    alt={album.title}
                    className={cn(
                        "absolute inset-0 w-full h-full object-cover transition-opacity duration-300",
                        isLoading ? "opacity-0" : "opacity-100"
                    )}
                    onLoad={() => setIsLoading(false)}
                    onError={(e) => {
                        e.currentTarget.style.display = 'none'
                    }}
                />
                <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-gray-200 to-gray-300 dark:from-gray-800 dark:to-gray-900 text-muted-foreground font-medium text-2xl -z-10">
                    {album.title.charAt(0)}
                </div>

                <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center z-10">
                    <Button
                        size="icon"
                        className="rounded-full h-14 w-14 bg-primary text-white hover:bg-primary/90 hover:scale-105 shadow-xl transition-all"
                        onClick={(e) => {
                            e.stopPropagation()
                            onClick()
                        }}
                    >
                        <Play className="h-6 w-6" fill="currentColor" />
                    </Button>
                </div>
            </div>
            <div className="space-y-1">
                <h3 className="font-medium leading-snug truncate text-sm hover:underline">{album.title}</h3>
                <p className="text-xs text-muted-foreground">
                    {album.tracks.length} {album.tracks.length === 1 ? 'Song' : 'Songs'}
                </p>
            </div>
        </Card>
    )
}

// Catalog album card component (from Apple Music)
function CatalogAlbumCard({
    album,
    onImport
}: {
    album: ArtistAlbumItem
    onImport: () => void
}) {
    const [isLoading, setIsLoading] = React.useState(true)

    return (
        <Card className="group overflow-hidden border-none shadow-none bg-transparent hover:bg-card/40 transition-colors">
            <div className="aspect-square bg-secondary rounded-md mb-3 relative overflow-hidden shadow-sm group-hover:shadow-md transition-all">
                {isLoading && (
                    <Skeleton className="absolute inset-0 w-full h-full bg-primary/10" />
                )}
                {album.artwork_url && (
                    <img
                        src={album.artwork_url}
                        alt={album.title}
                        className={cn(
                            "absolute inset-0 w-full h-full object-cover transition-opacity duration-300",
                            isLoading ? "opacity-0" : "opacity-100"
                        )}
                        onLoad={() => setIsLoading(false)}
                        onError={(e) => {
                            e.currentTarget.style.display = 'none'
                        }}
                    />
                )}
                <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-gray-200 to-gray-300 dark:from-gray-800 dark:to-gray-900 text-muted-foreground font-medium text-2xl -z-10">
                    {album.title.charAt(0)}
                </div>

                <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center z-10">
                    <Button
                        size="icon"
                        className="rounded-full h-14 w-14 bg-primary text-white hover:bg-primary/90 hover:scale-105 shadow-xl transition-all"
                        onClick={onImport}
                    >
                        <Download className="h-6 w-6" />
                    </Button>
                </div>
            </div>
            <div className="space-y-1">
                <h3 className="font-medium leading-snug truncate text-sm">{album.title}</h3>
                <p className="text-xs text-muted-foreground">
                    {album.release_date ? new Date(album.release_date).getFullYear() : ''}
                    {album.track_count && ` • ${album.track_count} ${album.track_count === 1 ? 'Song' : 'Songs'}`}
                </p>
            </div>
        </Card>
    )
}

export function ArtistDetailView({
    artistData,
    localArtist,
    cookiesConfigured,
    fetchingMetadata,
    onAlbumClick,
    onImportAlbum,
    onPlayAll,
    onShuffle
}: ArtistDetailViewProps) {
    const [heroImageLoaded, setHeroImageLoaded] = React.useState(false)
    const [heroVideoLoaded, setHeroVideoLoaded] = React.useState(false)
    const [profileImageLoaded, setProfileImageLoaded] = React.useState(false)

    const artistName = artistData?.name || localArtist?.name || "Unknown Artist"
    const artworkUrl = artistData?.artwork_url

    // Fallback to first album cover if no artist artwork (only for profile pic)
    const firstAlbumTrackId = localArtist?.albums?.[0]?.tracks?.[0]?.id
    const fallbackArtworkUrl = firstAlbumTrackId ? `/api/cover/${firstAlbumTrackId}?size=large` : undefined

    // Hero image: only use actual hero/artwork URLs, NOT fallback album cover
    const heroStaticUrl = artistData?.hero_static_url || artworkUrl
    const heroVideoUrl = artistData?.hero_video_url

    // Profile image: only use fallback after metadata fetch is complete
    // This prevents flashing the album cover before the real artwork loads
    const profileImageUrl = artworkUrl || (!fetchingMetadata ? fallbackArtworkUrl : undefined)

    // Reset loading states when URLs change
    React.useEffect(() => {
        setHeroImageLoaded(false)
        setHeroVideoLoaded(false)
    }, [heroStaticUrl, heroVideoUrl])

    React.useEffect(() => {
        setProfileImageLoaded(false)
    }, [profileImageUrl])

    const localAlbums = localArtist?.albums || []
    const catalogAlbums = artistData?.albums || []
    const catalogSingles = artistData?.singles || []

    return (
        <div className="h-full w-full overflow-auto">
            {/* Loading indicator for metadata fetch */}
            {fetchingMetadata && (
                <div className="sticky top-14 mt-14 z-30 bg-background/80 backdrop-blur-md border-b">
                    <div className="flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>Loading artist metadata...</span>
                    </div>
                </div>
            )}

            {/* Hero Banner */}
            <div className={cn(
                "relative h-80 md:h-96 overflow-hidden bg-gradient-to-b from-primary/20 to-background",
                !fetchingMetadata && "mt-14"
            )}>
                {/* Animated hero video (HLS stream) */}
                {heroVideoUrl && (
                    <video
                        autoPlay
                        loop
                        muted
                        playsInline
                        className={cn(
                            "absolute inset-0 w-full h-full object-cover transition-opacity duration-500",
                            heroVideoLoaded ? "opacity-60" : "opacity-0"
                        )}
                        onLoadedData={() => setHeroVideoLoaded(true)}
                    >
                        <source src={heroVideoUrl} type="video/mp4" />
                    </video>
                )}

                {/* Static hero image (fallback or if no video) */}
                {heroStaticUrl && !heroVideoLoaded && (
                    <img
                        src={heroStaticUrl}
                        alt=""
                        className={cn(
                            "absolute inset-0 w-full h-full object-cover transition-opacity duration-500",
                            heroImageLoaded ? "opacity-60" : "opacity-0"
                        )}
                        onLoad={() => setHeroImageLoaded(true)}
                    />
                )}

                {/* Gradient overlay for readability */}
                <div className="absolute inset-0 bg-gradient-to-t from-background via-background/50 to-transparent" />

                {/* Content container */}
                <div className="absolute bottom-0 left-0 right-0 p-8 flex items-end gap-6">
                    {/* Artist profile image */}
                    {profileImageUrl ? (
                        <div className="w-36 h-36 md:w-48 md:h-48 rounded-full overflow-hidden shadow-2xl flex-shrink-0 ring-4 ring-background/50">
                            <img
                                src={profileImageUrl}
                                alt={artistName}
                                className={cn(
                                    "w-full h-full object-cover transition-opacity duration-300",
                                    profileImageLoaded ? "opacity-100" : "opacity-0"
                                )}
                                onLoad={() => setProfileImageLoaded(true)}
                            />
                            {!profileImageLoaded && (
                                <Skeleton className="w-full h-full" />
                            )}
                        </div>
                    ) : (
                        <div className="w-36 h-36 md:w-48 md:h-48 rounded-full overflow-hidden shadow-2xl flex-shrink-0 bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center ring-4 ring-background/50">
                            <span className="text-6xl font-bold text-primary/50">
                                {artistName.charAt(0).toUpperCase()}
                            </span>
                        </div>
                    )}

                    {/* Artist info */}
                    <div className="flex flex-col gap-2 min-w-0">
                        <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Artist</p>
                        <h1 className="text-3xl md:text-5xl font-bold tracking-tight truncate leading-snug">
                            {artistName}
                        </h1>
                        {artistData?.genre && (
                            <p className="text-muted-foreground">{artistData.genre}</p>
                        )}
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="max-w-6xl mx-auto px-8 py-8 pb-32">
                {/* Play buttons for local albums */}
                {localAlbums.length > 0 && (
                    <div className="flex gap-3 mb-8">
                        <Button size="sm" onClick={onPlayAll} className="px-6 gap-2">
                            <Play className="h-4 w-4 fill-current" />
                            Play All
                        </Button>
                        <Button size="sm" variant="outline" onClick={onShuffle} className="px-6 gap-2">
                            <Shuffle className="h-4 w-4" />
                            Shuffle
                        </Button>
                    </div>
                )}

                {/* Local Library Albums */}
                {localAlbums.length > 0 && (
                    <section className="mb-12">
                        <h2 className="text-xl font-semibold mb-6">In Your Library</h2>
                        <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-6">
                            {localAlbums.map(album => (
                                <LocalAlbumCard
                                    key={album.id}
                                    album={album}
                                    onClick={() => onAlbumClick(album)}
                                />
                            ))}
                        </div>
                    </section>
                )}

                {/* Apple Music Catalog Albums */}
                {cookiesConfigured && artistData && catalogAlbums.length > 0 && (
                    <section className="mb-12">
                        <h2 className="text-xl font-semibold mb-6">Albums on Apple Music</h2>
                        <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-6">
                            {catalogAlbums.map(album => (
                                <CatalogAlbumCard
                                    key={album.apple_music_id}
                                    album={album}
                                    onImport={() => onImportAlbum(album.apple_music_id, artistData.storefront)}
                                />
                            ))}
                        </div>
                    </section>
                )}

                {/* Apple Music Singles & EPs */}
                {cookiesConfigured && artistData && catalogSingles.length > 0 && (
                    <section className="mb-12">
                        <h2 className="text-xl font-semibold mb-6">Singles & EPs</h2>
                        <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-6">
                            {catalogSingles.map(album => (
                                <CatalogAlbumCard
                                    key={album.apple_music_id}
                                    album={album}
                                    onImport={() => onImportAlbum(album.apple_music_id, artistData.storefront)}
                                />
                            ))}
                        </div>
                    </section>
                )}

                {/* About Section */}
                {(artistData?.bio || artistData?.origin || artistData?.birth_date || !cookiesConfigured) && (
                    <section className="mb-12">
                        <h2 className="text-xl font-semibold mb-6">About</h2>
                        <div className="space-y-6 max-w-2xl">
                            {artistData?.bio ? (
                                <p
                                    className="text-foreground/80 leading-relaxed"
                                    dangerouslySetInnerHTML={{ __html: artistData.bio }}
                                />
                            ) : !cookiesConfigured ? (
                                <p className="text-muted-foreground">
                                    Configure Apple Music cookies in settings to see artist information.
                                </p>
                            ) : null}

                            <div className="flex flex-wrap gap-x-8 gap-y-4 text-sm">
                                {artistData?.genre && (
                                    <div>
                                        <span className="text-muted-foreground">Genre: </span>
                                        <span>{artistData.genre}</span>
                                    </div>
                                )}
                                {artistData?.origin && (
                                    <div>
                                        <span className="text-muted-foreground">Origin: </span>
                                        <span>{artistData.origin}</span>
                                    </div>
                                )}
                                {artistData?.birth_date && (
                                    <div>
                                        <span className="text-muted-foreground">Born: </span>
                                        <span>{artistData.birth_date}</span>
                                    </div>
                                )}
                            </div>

                            {artistData?.url && (
                                <a
                                    href={artistData.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-primary hover:underline text-sm inline-block"
                                >
                                    View on Apple Music
                                </a>
                            )}
                        </div>
                    </section>
                )}

                {/* Empty state when no albums anywhere */}
                {localAlbums.length === 0 && catalogAlbums.length === 0 && catalogSingles.length === 0 && (
                    <div className="text-center text-muted-foreground py-16">
                        <p className="text-lg mb-2">No albums found</p>
                        {!cookiesConfigured && (
                            <p className="text-sm">Configure Apple Music cookies to see catalog albums</p>
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}
