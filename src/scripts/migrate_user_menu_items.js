import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../../.env') });

const DATABASE_URL = process.env.DATABASE_URL;

async function migrate() {
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
        console.log('✅ Connected to database. Creating "user_menu_items" table...');

        await client.query(`
            CREATE TABLE IF NOT EXISTS user_menu_items (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                menu_item_id TEXT NOT NULL,
                custom_price NUMERIC(10,2) NOT NULL DEFAULT 0.00,
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE CASCADE,
                CONSTRAINT unique_user_menu_item UNIQUE (user_id, menu_item_id)
            );

            CREATE INDEX IF NOT EXISTS idx_user_menu_items_user_id ON user_menu_items(user_id);
            CREATE INDEX IF NOT EXISTS idx_user_menu_items_menu_item_id ON user_menu_items(menu_item_id);
        `);

        console.log('✅ "user_menu_items" table and indices created successfully in Supabase!');

        const res = await client.query(`
            SELECT table_name FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_name = 'user_menu_items';
        `);
        console.log('Verification:', res.rows);

        client.release();
        await pool.end();
        console.log('🚀 Migration complete.');
    } catch (err) {
        console.error('❌ Migration failed:', err);
        process.exit(1);
    }
}

migrate();
