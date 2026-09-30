import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../../.env') });

const DATABASE_URL = process.env.DATABASE_URL;

async function inspect() {
    if (!DATABASE_URL) {
        console.error('❌ No DATABASE_URL in .env');
        process.exit(1);
    }

    const pool = new Pool({
        connectionString: DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    try {
        const client = await pool.connect();
        console.log('🔍 Inspecting menu_items table columns...');
        
        const colsRes = await client.query(`
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'menu_items'
            ORDER BY ordinal_position;
        `);
        console.log('📋 Columns in menu_items:');
        console.table(colsRes.rows);

        const constraintsRes = await client.query(`
            SELECT conname, contype, pg_get_constraintdef(c.oid) as def
            FROM pg_constraint c
            JOIN pg_namespace n ON n.oid = c.connamespace
            WHERE n.nspname = 'public' AND conrelid = 'menu_items'::regclass;
        `);
        console.log('🔒 Constraints on menu_items:');
        console.table(constraintsRes.rows);

        const indexesRes = await client.query(`
            SELECT indexname, indexdef
            FROM pg_indexes
            WHERE schemaname = 'public' AND tablename = 'menu_items';
        `);
        console.log('⚡ Indexes on menu_items:');
        console.table(indexesRes.rows);

        const countRes = await client.query(`SELECT COUNT(*) as count FROM menu_items;`);
        console.log(`📊 Total rows in menu_items: ${countRes.rows[0].count}`);

        const sampleRes = await client.query(`SELECT id, name, price, category, is_available, created_at FROM menu_items ORDER BY created_at ASC LIMIT 10;`);
        console.log('📦 Sample rows from menu_items:');
        console.table(sampleRes.rows);

        client.release();
        await pool.end();
    } catch (err) {
        console.error('❌ Inspection failed:', err);
    }
}

inspect();
