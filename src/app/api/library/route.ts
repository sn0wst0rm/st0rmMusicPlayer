import { NextResponse } from 'next/server';
import db from '@/lib/db';

export async function GET() {
    const artists = await db.artist.findMany({
        include: {
            albums: {
                include: {
                    tracks: {
                        orderBy: { trackNumber: 'asc' },
                        include: {
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
