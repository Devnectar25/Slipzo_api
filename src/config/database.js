import pkg from 'pg';
const { Pool } = pkg;
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_DATA_DIR = path.join(__dirname, '../../data');

export const SUPABASE_URL = process.env.SUPABASE_URL || 'https://apzabspkfpuszlduyoqv.supabase.co';
export const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwemFic3BrZnB1c3psZHV5b3F2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkwMTYzNTAsImV4cCI6MjEwNDU5MjM1MH0.T5RXzunQE2ih0yYXCqOAcb0QNXGJU2Py_gSiqYo4NMk';
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwemFic3BrZnB1c3psZHV5b3F2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4OTAxNjM1MCwiZXhwIjoyMTA0NTkyMzUwfQ._-AbXC08XTwVVif9BDVkNq2RDF1rULb-a_nMgLrFBQI';

// Initialize Supabase JS Client
export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY);

const DATABASE_URL = process.env.DATABASE_URL;

let isPg = false;
let pgPool = null;
let sqliteDb = null;

if (DATABASE_URL && (DATABASE_URL.startsWith('postgres://') || DATABASE_URL.startsWith('postgresql://'))) {
    isPg = true;
    console.log('🐘 Initializing PostgreSQL / Supabase connection pool...');
    pgPool = new Pool({
        connectionString: DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });
} else {
    try {
        const { createRequire } = await import('module');
        const require = createRequire(import.meta.url);
        const sqlite3 = require('sqlite3');
        const SQLITE_DB_PATH = process.env.DATABASE_PATH || path.join(DEFAULT_DATA_DIR, 'slipzo.db');
        const DB_DIR = path.dirname(SQLITE_DB_PATH);
        if (!fs.existsSync(DB_DIR)) {
            fs.mkdirSync(DB_DIR, { recursive: true });
        }
        const sqlite = sqlite3.verbose();
        sqliteDb = new sqlite.Database(SQLITE_DB_PATH);
        console.log('📁 Initializing SQLite 3 database at:', SQLITE_DB_PATH);
    } catch (err) {
        console.warn('⚠️ SQLite3 native module skipped (PostgreSQL / Serverless mode active):', err.message);
    }
}

export const db = sqliteDb;

// Async helper functions for SQLite3 (delegates to pg query if in PostgreSQL mode)
export const sqliteRun = (sql, params = []) => {
    if (isPg) return query(sql, params);
    if (!sqliteDb) return Promise.resolve({ lastID: null, changes: 0, affectedRows: 0 });
    return new Promise((resolve, reject) => {
        sqliteDb.run(sql, params, function(err) {
            if (err) return reject(err);
            resolve({ lastID: this.lastID, changes: this.changes, affectedRows: this.changes });
        });
    });
};

export const sqliteAll = (sql, params = []) => {
    if (isPg) return query(sql, params);
    if (!sqliteDb) return Promise.resolve([]);
    return new Promise((resolve, reject) => {
        sqliteDb.all(sql, params, (err, rows) => {
            if (err) return reject(err);
            resolve(rows || []);
        });
    });
};

export const sqliteGet = (sql, params = []) => {
    if (isPg) return queryOne(sql, params);
    if (!sqliteDb) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
        sqliteDb.get(sql, params, (err, row) => {
            if (err) return reject(err);
            resolve(row || null);
        });
    });
};

// Convert SQLite/MySQL '?' positional placeholders to PostgreSQL '$1', '$2', '$3'
function convertSqlPlaceholders(sql) {
    let index = 1;
    return sql.replace(/\?/g, () => `$${index++}`);
}

// Normalize SQL syntax per database engine
function normalizeSql(sql) {
    let clean = sql;
    if (isPg) {
        // Replace MySQL/SQLite DATE_SUB(NOW(), INTERVAL X DAY) with Postgres (NOW() - INTERVAL 'X days')
        clean = clean.replace(/DATE_SUB\s*\(\s*(?:NOW\(\)|CURRENT_TIMESTAMP)\s*,\s*INTERVAL\s+(\d+)\s+DAY\s*\)/gi, "(NOW() - INTERVAL '$1 days')");
    } else {
        clean = clean.replace(/DATE_SUB\s*\(\s*(?:NOW\(\)|CURRENT_TIMESTAMP)\s*,\s*INTERVAL\s+(\d+)\s+DAY\s*\)/gi, "datetime('now', '-$1 days')");
        clean = clean.replace(/\bNOW\(\)/gi, "datetime('now')");
    }
    return clean;
}

// Handle constraint & duplicate errors consistently across database engines
function formatDbError(err) {
    if (!err) return err;
    const msg = err.message || '';
    const code = err.code || '';
    if (code === '23505' || msg.includes('UNIQUE constraint failed') || code === 'SQLITE_CONSTRAINT') {
        if (msg.includes('users.email') || msg.includes('email') || msg.includes('users_email_key')) {
            const dupErr = new Error('Email already registered');
            dupErr.code = 'ER_DUP_ENTRY';
            return dupErr;
        }
        const dupErr = new Error('Duplicate entry');
        dupErr.code = 'ER_DUP_ENTRY';
        return dupErr;
    }
    return err;
}

// Initialize database schema
export const initDatabase = async () => {
    try {
        if (isPg) {
            await pgPool.query(`
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY,
                    username TEXT,
                    email TEXT UNIQUE NOT NULL,
                    password TEXT NOT NULL,
                    name TEXT NOT NULL,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                );

                ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT;

                CREATE TABLE IF NOT EXISTS shops (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    address TEXT,
                    phone TEXT,
                    gstin TEXT,
                    show_tax INTEGER DEFAULT 1,
                    tax_rate NUMERIC(5,2) DEFAULT 18.00,
                    invoice_prefix TEXT DEFAULT 'SLP',
                    invoice_sequence INTEGER DEFAULT 1001,
                    invoice_format TEXT DEFAULT 'PREFIX-DATE-SEQ',
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                    CONSTRAINT unique_user_shop UNIQUE(user_id)
                );

                ALTER TABLE shops ADD COLUMN IF NOT EXISTS gstin TEXT;
                ALTER TABLE shops ADD COLUMN IF NOT EXISTS show_tax INTEGER DEFAULT 1;
                ALTER TABLE shops ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(5,2) DEFAULT 18.00;

                DROP VIEW IF EXISTS user_shop_details CASCADE;

                CREATE OR REPLACE VIEW user_shop_details AS
                SELECT 
                    u.id AS user_id,
                    u.username,
                    u.name AS user_name,
                    u.email AS user_email,
                    u.created_at AS user_created_at,
                    s.id AS shop_id,
                    s.name AS shop_name,
                    s.address AS shop_address,
                    s.phone AS shop_phone,
                    s.gstin AS shop_gstin,
                    s.show_tax AS shop_show_tax,
                    s.tax_rate AS shop_tax_rate,
                    s.invoice_prefix,
                    s.invoice_sequence,
                    s.invoice_format
                FROM users u
                LEFT JOIN shops s ON s.user_id = u.id;



                CREATE TABLE IF NOT EXISTS customers (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    phone TEXT,
                    email TEXT,
                    address TEXT,
                    gstin TEXT,
                    notes TEXT,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS templates (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    category TEXT,
                    badge TEXT,
                    width TEXT DEFAULT '58mm',
                    show_tax INTEGER DEFAULT 1,
                    tax_rate NUMERIC(5,2) DEFAULT 18.00,
                    footer TEXT DEFAULT 'Thank you for shopping with us!',
                    description TEXT,
                    gradient TEXT,
                    accent_color TEXT,
                    features TEXT,
                    is_builtin INTEGER DEFAULT 0,
                    is_default INTEGER DEFAULT 0,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                );

                ALTER TABLE templates ADD COLUMN IF NOT EXISTS category TEXT;
                ALTER TABLE templates ADD COLUMN IF NOT EXISTS badge TEXT;
                ALTER TABLE templates ADD COLUMN IF NOT EXISTS description TEXT;
                ALTER TABLE templates ADD COLUMN IF NOT EXISTS gradient TEXT;
                ALTER TABLE templates ADD COLUMN IF NOT EXISTS accent_color TEXT;
                ALTER TABLE templates ADD COLUMN IF NOT EXISTS features TEXT;
                ALTER TABLE templates ADD COLUMN IF NOT EXISTS is_builtin INTEGER DEFAULT 0;


                CREATE TABLE IF NOT EXISTS bills (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    template_id TEXT NOT NULL,
                    customer_id TEXT,
                    customer_name TEXT,
                    customer_phone TEXT,
                    number TEXT UNIQUE NOT NULL,
                    discount NUMERIC(10,2) DEFAULT 0.00,
                    tax_rate NUMERIC(5,2) DEFAULT 0.00,
                    payment_mode TEXT DEFAULT 'Cash',
                    shop_name TEXT NOT NULL,
                    shop_address TEXT,
                    shop_phone TEXT,
                    template_name TEXT,
                    template_width TEXT DEFAULT '58mm',
                    subtotal NUMERIC(10,2) DEFAULT 0.00,
                    tax_amount NUMERIC(10,2) DEFAULT 0.00,
                    total NUMERIC(10,2) DEFAULT 0.00,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS bill_items (
                    id TEXT PRIMARY KEY,
                    bill_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    quantity INTEGER NOT NULL DEFAULT 1,
                    rate NUMERIC(10,2) NOT NULL DEFAULT 0.00,
                    amount NUMERIC(10,2) DEFAULT 0.00,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS products (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    price NUMERIC(10,2) NOT NULL DEFAULT 0.00,
                    category TEXT DEFAULT 'General',
                    sku TEXT,
                    tax_rate NUMERIC(5,2) DEFAULT 0.00,
                    stock INTEGER DEFAULT 100,
                    description TEXT,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS sessions (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    token TEXT NOT NULL,
                    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS contact_submissions (
                    id TEXT PRIMARY KEY,
                    user_id TEXT,
                    name TEXT NOT NULL,
                    email TEXT NOT NULL,
                    phone TEXT,
                    topic TEXT DEFAULT 'general',
                    message TEXT NOT NULL,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                );

                CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
                CREATE INDEX IF NOT EXISTS idx_customers_user_id ON customers(user_id);
                CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
                CREATE INDEX IF NOT EXISTS idx_templates_user_id ON templates(user_id);
                CREATE INDEX IF NOT EXISTS idx_bills_user_id ON bills(user_id);
                CREATE INDEX IF NOT EXISTS idx_bills_number ON bills(number);
                CREATE INDEX IF NOT EXISTS idx_bill_items_bill_id ON bill_items(bill_id);
                CREATE INDEX IF NOT EXISTS idx_products_user_id ON products(user_id);
                CREATE INDEX IF NOT EXISTS idx_contact_submissions_email ON contact_submissions(email);
            `);
            console.log('✅ Supabase PostgreSQL Database initialized successfully!');
        } else {
            // Enable Foreign Keys & WAL mode for SQLite
            await sqliteRun('PRAGMA foreign_keys = ON');
            await sqliteRun('PRAGMA journal_mode = WAL');

            await sqliteRun(`
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY,
                    username TEXT,
                    email TEXT UNIQUE NOT NULL,
                    password TEXT NOT NULL,
                    name TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);


            await sqliteRun(`
                CREATE TABLE IF NOT EXISTS shops (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    address TEXT,
                    phone TEXT,
                    invoice_prefix TEXT DEFAULT 'SLP',
                    invoice_sequence INTEGER DEFAULT 1001,
                    invoice_format TEXT DEFAULT 'PREFIX-DATE-SEQ',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                    UNIQUE(user_id)
                )
            `);

            await sqliteRun(`
                CREATE TABLE IF NOT EXISTS customers (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    phone TEXT,
                    email TEXT,
                    address TEXT,
                    gstin TEXT,
                    notes TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                )
            `);

            await sqliteRun(`
                CREATE TABLE IF NOT EXISTS templates (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    width TEXT DEFAULT '58mm',
                    show_tax INTEGER DEFAULT 1,
                    tax_rate REAL DEFAULT 18.00,
                    footer TEXT DEFAULT 'Thank you for shopping with us!',
                    is_default INTEGER DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                )
            `);

            await sqliteRun(`
                CREATE TABLE IF NOT EXISTS bills (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    template_id TEXT NOT NULL,
                    customer_id TEXT,
                    customer_name TEXT,
                    customer_phone TEXT,
                    number TEXT UNIQUE NOT NULL,
                    discount REAL DEFAULT 0.00,
                    tax_rate REAL DEFAULT 0.00,
                    payment_mode TEXT DEFAULT 'Cash',
                    shop_name TEXT NOT NULL,
                    shop_address TEXT,
                    shop_phone TEXT,
                    template_name TEXT,
                    template_width TEXT DEFAULT '58mm',
                    subtotal REAL DEFAULT 0.00,
                    tax_amount REAL DEFAULT 0.00,
                    total REAL DEFAULT 0.00,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                )
            `);

            await sqliteRun(`
                CREATE TABLE IF NOT EXISTS bill_items (
                    id TEXT PRIMARY KEY,
                    bill_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    quantity INTEGER NOT NULL DEFAULT 1,
                    rate REAL NOT NULL DEFAULT 0.00,
                    amount REAL DEFAULT 0.00,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE
                )
            `);

            await sqliteRun(`
                CREATE TABLE IF NOT EXISTS products (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    price REAL NOT NULL DEFAULT 0.00,
                    category TEXT DEFAULT 'General',
                    sku TEXT,
                    tax_rate REAL DEFAULT 0.00,
                    stock INTEGER DEFAULT 100,
                    description TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                )
            `);

            await sqliteRun(`
                CREATE TABLE IF NOT EXISTS sessions (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    token TEXT NOT NULL,
                    expires_at DATETIME NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                )
            `);

            await sqliteRun(`
                CREATE TABLE IF NOT EXISTS contact_submissions (
                    id TEXT PRIMARY KEY,
                    user_id TEXT,
                    name TEXT NOT NULL,
                    email TEXT NOT NULL,
                    phone TEXT,
                    topic TEXT DEFAULT 'general',
                    message TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);

            await sqliteRun(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
            await sqliteRun(`CREATE INDEX IF NOT EXISTS idx_customers_user_id ON customers(user_id)`);
            await sqliteRun(`CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone)`);
            await sqliteRun(`CREATE INDEX IF NOT EXISTS idx_templates_user_id ON templates(user_id)`);
            await sqliteRun(`CREATE INDEX IF NOT EXISTS idx_bills_user_id ON bills(user_id)`);
            await sqliteRun(`CREATE INDEX IF NOT EXISTS idx_bills_number ON bills(number)`);
            await sqliteRun(`CREATE INDEX IF NOT EXISTS idx_bill_items_bill_id ON bill_items(bill_id)`);
            await sqliteRun(`CREATE INDEX IF NOT EXISTS idx_products_user_id ON products(user_id)`);
            await sqliteRun(`CREATE INDEX IF NOT EXISTS idx_contact_submissions_email ON contact_submissions(email)`);

            console.log('✅ SQLite 3 Database initialized successfully!');
        }
    } catch (err) {
        console.error('❌ Failed to initialize database:', err.message);
        throw err;
    }
};

export const query = async (sql, params = []) => {
    try {
        const normalized = normalizeSql(sql);
        if (isPg) {
            const pgSql = convertSqlPlaceholders(normalized);
            const res = await pgPool.query(pgSql, params);
            if (pgSql.trim().toLowerCase().startsWith('select')) {
                return res.rows;
            }
            return {
                affectedRows: res.rowCount,
                changes: res.rowCount,
                rowCount: res.rowCount,
                rows: res.rows
            };
        } else {
            const trimmed = normalized.trim().toLowerCase();
            if (trimmed.startsWith('select')) {
                return await sqliteAll(normalized, params);
            } else {
                return await sqliteRun(normalized, params);
            }
        }
    } catch (err) {
        throw formatDbError(err);
    }
};

export const queryOne = async (sql, params = []) => {
    try {
        const normalized = normalizeSql(sql);
        if (isPg) {
            const pgSql = convertSqlPlaceholders(normalized);
            const res = await pgPool.query(pgSql, params);
            return res.rows[0] || null;
        } else {
            const row = await sqliteGet(normalized, params);
            return row || null;
        }
    } catch (err) {
        throw formatDbError(err);
    }
};

export const insert = async (table, data) => {
    try {
        const keys = Object.keys(data);
        const values = Object.values(data);
        const placeholders = keys.map(() => '?').join(', ');
        const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`;
        return await query(sql, values);
    } catch (err) {
        throw formatDbError(err);
    }
};

export const update = async (table, data, where, whereParams = []) => {
    try {
        const keys = Object.keys(data);
        const setClause = keys.map(key => `${key} = ?`).join(', ');
        const values = [...Object.values(data), ...whereParams];
        const sql = `UPDATE ${table} SET ${setClause} WHERE ${where}`;
        return await query(sql, values);
    } catch (err) {
        throw formatDbError(err);
    }
};

export const deleteById = async (table, id) => {
    try {
        const result = await query(`DELETE FROM ${table} WHERE id = ?`, [id]);
        const affected = result ? (result.affectedRows || result.changes || 0) : 0;
        return affected > 0;
    } catch (err) {
        throw formatDbError(err);
    }
};

export const beginTransaction = async () => {
    if (isPg) {
        const client = await pgPool.connect();
        await client.query('BEGIN');
        return {
            query: async (sql, params = []) => {
                const normalized = normalizeSql(sql);
                const pgSql = convertSqlPlaceholders(normalized);
                const res = await client.query(pgSql, params);
                return pgSql.trim().toLowerCase().startsWith('select') ? res.rows : { affectedRows: res.rowCount, rows: res.rows };
            },
            commit: async () => {
                await client.query('COMMIT');
                client.release();
            },
            rollback: async () => {
                await client.query('ROLLBACK');
                client.release();
            },
            release: () => {
                try { client.release(); } catch (e) {}
            }
        };
    } else {
        await sqliteRun('BEGIN TRANSACTION');
        return {
            query: async (sql, params = []) => query(sql, params),
            commit: async () => sqliteRun('COMMIT'),
            rollback: async () => sqliteRun('ROLLBACK'),
            release: () => {}
        };
    }
};

export default { 
    db: sqliteDb, 
    query, 
    queryOne, 
    insert, 
    update, 
    deleteById, 
    initDatabase,
    beginTransaction,
    supabase,
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY
};