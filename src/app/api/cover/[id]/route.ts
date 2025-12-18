import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import fs from "fs";
import path from "path";
import { getCoverPath, generateCovers, CoverSize } from "@/lib/cover";

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const id = (await params).id;
        if (!id) return new NextResponse("Missing ID", { status: 400 });

        const url = new URL(req.url);
        const sizeParam = url.searchParams.get("size"); // 'small', 'medium', 'large'
        const size: CoverSize = (sizeParam === 'small' || sizeParam === 'medium' || sizeParam === 'large')
            ? sizeParam
            : 'large'; // Default to large/original if not specified, or maybe medium? Let's stick to large to match old behavior best.

        // 1. Resolve Album ID from Track ID
        // The 'id' parameter is a Track ID.
        const track = await prisma.track.findUnique({
            where: { id },
            include: { album: true },
        });

        if (!track || !track.filePath || !fs.existsSync(track.filePath)) {
            return new NextResponse("Track not found", { status: 404 });
        }

        if (!track.album) {
            return new NextResponse("Album not found", { status: 404 });
        }

        const albumId = track.album.id;

        // 2. Check if we have a valid cached path in DB
        let coverPath = await getCoverPath(albumId, size);
        const fileExists = coverPath ? fs.existsSync(coverPath) : false;

        // 3. If not found or file missing, generate
        if (!coverPath || !fileExists) {
            // Generate covers using the track's file
            const generated = await generateCovers(albumId, track.filePath);
            if (!generated) {
                return new NextResponse("No cover art found in metadata", { status: 404 });
            }

            if (size === 'small') coverPath = generated.small;
            else if (size === 'medium') coverPath = generated.medium;
            else coverPath = generated.large;
        }

        if (!coverPath || !fs.existsSync(coverPath)) {
            return new NextResponse("Error retrieving cover", { status: 500 });
        }

        // 3. Serve the file
        const fileBuffer = fs.readFileSync(coverPath);
        // readFileSync is simple. For large files streams are better, but covers are relatively small (<5MB). 
        // Sharp saves as JPEG/PNG.

        // Determine content type (usually jpeg based on my sharp config)
        const ext = path.extname(coverPath).toLowerCase();
        let contentType = "image/jpeg";
        if (ext === ".png") contentType = "image/png";

        return new NextResponse(fileBuffer, {
            headers: {
                "Content-Type": contentType,
                "Cache-Control": "public, max-age=86400, mutable", // mutable because we might update it? actually immutable is better for versioned urls, but here URL is stable. 
                // Let's use standard caching.
            },
        });

    } catch (error) {
        console.error("Cover fetch error:", error);
        return new NextResponse("Internal Server Error", { status: 500 });
    }
}
