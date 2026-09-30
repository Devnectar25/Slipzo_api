import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../../.env') });

const DATABASE_URL = process.env.DATABASE_URL;

async function migrateBarcode() {
    if (!DATABASE_URL) {
        console.error('❌ No DATABASE_URL in .env');
        process.exit(1);
    }

    console.log('🐘 Connecting to Supabase PostgreSQL...');
    const pool = new Pool({
        connectionString: DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    try {
        const client = await pool.connect();
        console.log('✅ Connected to database. Executing Phase 1 barcode migration...');

        // 1. Add barcode and barcode_type columns if not present
        await client.query(`
            ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS barcode TEXT;
            ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS barcode_type TEXT DEFAULT 'INTERNAL';
        `);
        console.log('✅ Columns "barcode" and "barcode_type" added / verified on "menu_items".');

        // 2. Fetch all menu_items ordered by created_at, id
        const itemsRes = await client.query(`
            SELECT id, name, price, category, barcode, barcode_type, created_at 
            FROM menu_items 
            ORDER BY created_at ASC, id ASC;
        `);
        console.log(`📊 Total master menu items: ${itemsRes.rows.length}`);

        // 3. Populate missing barcodes using standard SLP-00000X format
        let assignedCount = 0;
        let index = 1;
        
        // Find existing assigned barcodes to avoid collisions
        const existingBarcodes = new Set(
            itemsRes.rows
                .map(r => r.barcode)
                .filter(Boolean)
        );

        for (const item of itemsRes.rows) {
            if (!item.barcode) {
                let candidate = `SLP-${String(index).padStart(6, '0')}`;
                while (existingBarcodes.has(candidate)) {
                    index++;
                    candidate = `SLP-${String(index).padStart(6, '0')}`;
                }
                existingBarcodes.add(candidate);

                await client.query(`
                    UPDATE menu_items 
                    SET barcode = $1, barcode_type = COALESCE(barcode_type, 'INTERNAL'), updated_at = CURRENT_TIMESTAMP
                    WHERE id = $2;
                `, [candidate, item.id]);

                assignedCount++;
                index++;
            }
        }
        console.log(`✅ Barcodes assigned to ${assignedCount} items (already assigned: ${itemsRes.rows.length - assignedCount}).`);

        // 4. Create unique index on barcode
        await client.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_menu_items_barcode 
            ON menu_items(barcode) 
            WHERE barcode IS NOT NULL;
        `);
        console.log('✅ Unique index "idx_menu_items_barcode" created / verified on "menu_items(barcode)".');

        // 5. Validation Queries
        const verifyRes = await client.query(`
            SELECT 
                COUNT(*) as total_items,
                COUNT(barcode) as items_with_barcode,
                COUNT(DISTINCT barcode) as unique_barcodes
            FROM menu_items;
        `);
        console.log('🔍 Validation Summary:', verifyRes.rows[0]);

        const dupCheck = await client.query(`
            SELECT barcode, COUNT(*) 
            FROM menu_items 
            WHERE barcode IS NOT NULL 
            GROUP BY barcode 
            HAVING COUNT(*) > 1;
        `);
        if (dupCheck.rows.length > 0) {
            console.error('❌ Duplicate barcodes found:', dupCheck.rows);
            process.exit(1);
        } else {
            console.log('✅ Zero duplicate barcodes detected!');
        }

        client.release();
        await pool.end();
        console.log('🎉 Phase 1 Database Migration completed successfully.');
    } catch (err) {
        console.error('❌ Migration error:', err);
        process.exit(1);
    }
}

migrateBarcode();
