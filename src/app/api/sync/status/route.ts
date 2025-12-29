import { NextResponse } from 'next/server';
import db from '@/lib/db';

const GAMDL_SERVICE_URL = process.env.GAMDL_SERVICE_URL || 'http://127.0.0.1:5100';

// GET sync status
export async function GET() {
    try {
        // Get settings with sync config
        const settings = await db.gamdlSettings.findUnique({
            where: { id: 'singleton' }
        });

        // Get synced playlists
        const syncedPlaylists = await db.playlist.findMany({
            where: { isSynced: true },
            select: {
                id: true,
                name: true,
                appleMusicId: true,
                globalId: true,
                lastSyncedAt: true,
                appleLastModifiedDate: true,
                artworkUrl: true,
                _count: {
                    select: { tracks: true }
                }
            },
            orderBy: { lastSyncedAt: 'desc' }
        });

        // Extract storefront from language setting (e.g., "en-US" -> "us", "it-IT" -> "it")
        let storefront = 'us';
        if (settings?.language) {
            const parts = settings.language.split('-');
            if (parts.length >= 2) {
                storefront = parts[1].toLowerCase();
            }
        }

        return NextResponse.json({
            syncEnabled: settings?.syncEnabled ?? false,
            syncInterval: settings?.syncInterval ?? 60,
            autoSyncOnChange: settings?.autoSyncOnChange ?? false,
            lastSyncCheck: settings?.lastSyncCheck ?? null,
            storefront, // Derived from language setting
            syncedPlaylists: syncedPlaylists.map(p => ({
                id: p.id,
                name: p.name,
                appleMusicId: p.appleMusicId,
                globalId: p.globalId,
                lastSyncedAt: p.lastSyncedAt,
                appleLastModifiedDate: p.appleLastModifiedDate,
                artworkUrl: p.artworkUrl,
                trackCount: p._count.tracks
            }))
        });
    } catch (error) {
        console.error('Error fetching sync status:', error);
        return NextResponse.json(
            { error: 'Failed to fetch sync status' },
            { status: 500 }
        );
    }
}

// POST - trigger a manual sync check
export async function POST() {
    try {
        // Trigger sync via gamdl service
        const response = await fetch(`${GAMDL_SERVICE_URL}/trigger-sync-check`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(10000)
        });

        if (!response.ok) {
            const error = await response.text();
            return NextResponse.json(
                { error: `Sync trigger failed: ${error}` },
                { status: response.status }
            );
        }

        return NextResponse.json({ success: true, message: 'Sync check triggered' });
    } catch (error) {
        console.error('Error triggering sync:', error);
        return NextResponse.json(
            { error: 'Failed to trigger sync. Is the gamdl service running?' },
            { status: 500 }
        );
    }
}
