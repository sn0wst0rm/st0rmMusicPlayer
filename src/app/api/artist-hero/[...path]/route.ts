import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/db"
import fs from "fs"
import path from "path"

/**
 * Serves artist hero media files from the artist's .metadata folder.
 *
 * Routes:
 * - /api/artist-hero/{artistId}/hero-animated.mp4
 * - /api/artist-hero/{artistId}/hero-static.jpg
 * - /api/artist-hero/{artistId}/profile.jpg
 */
export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ path: string[] }> }
) {
    try {
        const pathParts = (await params).path

        if (!pathParts || pathParts.length < 2) {
            return new NextResponse("Invalid path", { status: 400 })
        }

        const artistId = pathParts[0]
        const filename = pathParts[1]

        // Find artist by ID (could be appleMusicId or internal ID)
        let artist = await prisma.artist.findFirst({
            where: {
                OR: [
                    { id: artistId },
                    { appleMusicId: artistId }
                ]
            }
        })

        if (!artist) {
            return new NextResponse("Artist not found", { status: 404 })
        }

        // Determine which file path to use based on filename
        let filePath: string | null = null

        switch (filename) {
            case "hero-animated.mp4":
                filePath = artist.heroAnimatedPath
                break
            case "hero-static.jpg":
                filePath = artist.heroStaticPath
                break
            case "profile.jpg":
                filePath = artist.profileImagePath
                break
            default:
                return new NextResponse("Invalid filename", { status: 400 })
        }

        if (!filePath) {
            return new NextResponse("Media not available", { status: 404 })
        }

        // Verify file exists
        if (!fs.existsSync(filePath)) {
            console.error(`Artist hero media file not found: ${filePath}`)
            return new NextResponse("File not found", { status: 404 })
        }

        // Read and serve the file
        const fileBuffer = fs.readFileSync(filePath)

        // Determine content type
        const ext = path.extname(filePath).toLowerCase()
        let contentType = "application/octet-stream"

        if (ext === ".mp4") {
            contentType = "video/mp4"
        } else if (ext === ".jpg" || ext === ".jpeg") {
            contentType = "image/jpeg"
        } else if (ext === ".png") {
            contentType = "image/png"
        }

        return new NextResponse(fileBuffer, {
            headers: {
                "Content-Type": contentType,
                "Cache-Control": "public, max-age=604800", // Cache for 1 week
            },
        })

    } catch (error) {
        console.error("Artist hero media fetch error:", error)
        return new NextResponse("Internal Server Error", { status: 500 })
    }
}
