import { NextResponse } from 'next/server';
import { scanLibrary } from '@/lib/scanner';
import { convertLibrary } from '@/lib/converter';

export async function POST() {
    // Fire and forget - risky in serverless, fine in local long-running server
    (async () => {
        try {
            await scanLibrary();
            await convertLibrary();
        } catch (error) {
            console.error('Background scan failed:', error);
        }
    })();

    return NextResponse.json({ message: 'Scan started in background' });
}
