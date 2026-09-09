import sqlite3 from 'sqlite3';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_DATA_DIR = path.join(__dirname, '../../data');
const SQLITE_DB_PATH = process.env.DATABASE_PATH || path.join(DEFAULT_DATA_DIR, 'slipzo.db');
const DB_DIR = path.dirname(SQLITE_DB_PATH);

// Ensure data directory exists
if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
}

const sqlite = sqlite3.verbose();
export const db = new sqlite.Database(SQLITE_DB_PATH);

// Async helper functions for SQLite3
export const sqliteRun = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) return reject(err);
            resolve({ lastID: this.lastID, changes: this.changes, affectedRows: this.changes });
        });
    });
};

export const sqliteAll = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) return reject(err);
            resolve(rows || []);
        });
    });
};

export const sqliteGet = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) return reject(err);
            resolve(row || null);
        });
    });
};

// Normalize MySQL specific syntax to SQLite 3 syntax
function normalizeSql(sql) {
    let clean = sql;
    // Replace MySQL DATE_SUB(NOW(), INTERVAL 30 DAY) with SQLite datetime('now', '-30 days')
    clean = clean.replace(/DATE_SUB\s*\(\s*(?:NOW\(\)|CURRENT_TIMESTAMP)\s*,\s*INTERVAL\s+(\d+)\s+DAY\s*\)/gi, "datetime('now', '-$1 days')");
    // Replace NOW() with datetime('now')
    clean = clean.replace(/\bNOW\(\)/gi, "datetime('now')");
    return clean;
}

// Handle constraint & duplicate errors consistently with MySQL error format
function formatDbError(err) {
    if (!err) return err;
    const msg = err.message || '';
    if (msg.includes('UNIQUE constraint failed') || err.code === 'SQLITE_CONSTRAINT') {
        if (msg.includes('users.email') || msg.includes('email')) {
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
        // Enable Foreign Keys & WAL mode for SQLite
        await sqliteRun('PRAGMA foreign_keys = ON');
        await sqliteRun('PRAGMA journal_mode = WAL');

        // Create Tables
        await sqliteRun(`
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
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

        // Create Indexes
        await sqliteRun(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
        await sqliteRun(`CREATE INDEX IF NOT EXISTS idx_customers_user_id ON customers(user_id)`);
        await sqliteRun(`CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone)`);
        await sqliteRun(`CREATE INDEX IF NOT EXISTS idx_templates_user_id ON templates(user_id)`);
        await sqliteRun(`CREATE INDEX IF NOT EXISTS idx_bills_user_id ON bills(user_id)`);
        await sqliteRun(`CREATE INDEX IF NOT EXISTS idx_bills_number ON bills(number)`);
        await sqliteRun(`CREATE INDEX IF NOT EXISTS idx_bill_items_bill_id ON bill_items(bill_id)`);
        await sqliteRun(`CREATE INDEX IF NOT EXISTS idx_products_user_id ON products(user_id)`);

        console.log('✅ SQLite 3 Database initialized successfully at:', SQLITE_DB_PATH);
    } catch (err) {
        console.error('❌ Failed to initialize SQLite 3 database:', err.message);
        throw err;
    }
};

export const query = async (sql, params = []) => {
    try {
        const normalized = normalizeSql(sql);
        const trimmed = normalized.trim().toLowerCase();

        if (trimmed.startsWith('select')) {
            return await sqliteAll(normalized, params);
        } else {
            return await sqliteRun(normalized, params);
        }
    } catch (err) {
        throw formatDbError(err);
    }
};

export const queryOne = async (sql, params = []) => {
    try {
        const normalized = normalizeSql(sql);
        const row = await sqliteGet(normalized, params);
        return row || null;
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
        const result = await sqliteRun(sql, values);
        return result;
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
        const result = await sqliteRun(sql, values);
        return result;
    } catch (err) {
        throw formatDbError(err);
    }
};

export const deleteById = async (table, id) => {
    try {
        const result = await sqliteRun(`DELETE FROM ${table} WHERE id = ?`, [id]);
        return result.changes > 0;
    } catch (err) {
        throw formatDbError(err);
    }
};

export const beginTransaction = async () => {
    await sqliteRun('BEGIN TRANSACTION');
    return {
        query: async (sql, params = []) => query(sql, params),
        commit: async () => sqliteRun('COMMIT'),
        rollback: async () => sqliteRun('ROLLBACK'),
        release: () => {}
    };
};

export default { 
    db, 
    query, 
    queryOne, 
    insert, 
    update, 
    deleteById, 
    initDatabase,
    beginTransaction
};