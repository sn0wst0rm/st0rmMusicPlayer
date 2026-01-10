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

        // Get file stats for size
        const stat = fs.statSync(filePath)
        const fileSize = stat.size

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

        // Check for Range header (Safari and other browsers use this for video streaming)
        const range = req.headers.get("range")

        if (range && ext === ".mp4") {
            // Parse range header (e.g., "bytes=0-1023")
            const parts = range.replace(/bytes=/, "").split("-")
            const start = parseInt(parts[0], 10)
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1
            const chunkSize = end - start + 1

            // Create read stream for the requested range
            const fileStream = fs.createReadStream(filePath, { start, end })
            const chunks: Buffer[] = []

            for await (const chunk of fileStream) {
                chunks.push(Buffer.from(chunk))
            }
            const buffer = Buffer.concat(chunks)

            return new NextResponse(buffer, {
                status: 206,
                headers: {
                    "Content-Type": contentType,
                    "Content-Length": chunkSize.toString(),
                    "Content-Range": `bytes ${start}-${end}/${fileSize}`,
                    "Accept-Ranges": "bytes",
                    "Cache-Control": "public, max-age=604800",
                },
            })
        }

        // No range request - return full file
        const fileBuffer = fs.readFileSync(filePath)

        return new NextResponse(fileBuffer, {
            headers: {
                "Content-Type": contentType,
                "Content-Length": fileSize.toString(),
                "Accept-Ranges": "bytes",
                "Cache-Control": "public, max-age=604800", // Cache for 1 week
            },
        })

    } catch (error) {
        console.error("Artist hero media fetch error:", error)
        return new NextResponse("Internal Server Error", { status: 500 })
    }
}
