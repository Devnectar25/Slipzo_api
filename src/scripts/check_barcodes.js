import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../../.env') });

const DATABASE_URL = process.env.DATABASE_URL;

async function checkBarcodes() {
    const pool = new Pool({
        connectionString: DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    try {
        const client = await pool.connect();
        const rowsRes = await client.query(`
            SELECT id, name, barcode, barcode_type 
            FROM menu_items 
            ORDER BY created_at ASC;
        `);
        console.table(rowsRes.rows);

        const nonNullCount = rowsRes.rows.filter(r => r.barcode !== null).length;
        console.log(`📊 Rows with non-null barcode: ${nonNullCount} / ${rowsRes.rows.length}`);

        client.release();
        await pool.end();
    } catch (err) {
        console.error('❌ Check failed:', err);
    }
}

checkBarcodes();
