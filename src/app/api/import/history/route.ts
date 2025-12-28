import { NextResponse } from 'next/server';
import db from '@/lib/db';

// DELETE - Clear all import history
export async function DELETE() {
    try {
        await db.importJob.deleteMany({});
        return NextResponse.json({ success: true, message: 'Import history cleared' });
    } catch (error) {
        console.error('Error clearing import history:', error);
        return NextResponse.json(
            { error: 'Failed to clear import history' },
            { status: 500 }
        );
    }
}
