import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import Database from 'better-sqlite3';
import path from 'path';

async function main() {
    console.log('Initializing DB...');
    try {
        const dbPath = path.resolve(process.cwd(), 'library.db');
        const sqlite = new Database(dbPath);
        const adapter = new PrismaBetterSqlite3(sqlite);
        const prisma = new PrismaClient({ adapter });

        console.log('Connecting...');
        await prisma.$connect();
        console.log('Connected!');

        const count = await prisma.artist.count();
        console.log('Artist count:', count);

        await prisma.$disconnect();
    } catch (e) {
        console.error('Error:', e);
    }
}

main();
