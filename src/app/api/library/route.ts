import { NextResponse } from 'next/server';
import db from '@/lib/db';

export async function GET() {
    const artists = await db.artist.findMany({
        select: {
            id: true,
            name: true,
            appleMusicId: true,
            sortName: true,
            artworkUrl: true,
            bio: true,
            genre: true,
            origin: true,
            birthDate: true,
            url: true,
            isGroup: true,
            plainEditorialNotes: true,
            heroAnimatedPath: true,
            heroStaticPath: true,
            profileImagePath: true,
            albums: {
                select: {
                    id: true,
                    title: true,
                    description: true,
                    copyright: true,
                    genre: true,
                    releaseDate: true,
                    recordLabel: true,
                    animatedCoverPath: true,
                    tracks: {
                        orderBy: { trackNumber: 'asc' },
                        select: {
                            id: true,
                            title: true,
                            trackNumber: true,
                            discNumber: true,
                            duration: true,
                            filePath: true,
                            composer: true,
                            genre: true,
                            lyricsPath: true,
                            album: {
                                select: {
                                    title: true,
                                    animatedCoverPath: true
                                }
                            }
                        }
                    }
                }
            }
        },
        orderBy: { name: 'asc' }
    });

    return NextResponse.json(artists);
}
