import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '../../data');
const JSON_DB_FILE = path.join(DATA_DIR, 'slipzo_db.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

let isMySQLActive = false;

// Connection pool
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'slipzo',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    charset: 'utf8mb4'
});

// JSON fallback DB structure
let localData = {
    users: [],
    shops: [],
    customers: [],
    templates: [],
    bills: [],
    bill_items: [],
    sessions: []
};

function loadLocalDb() {
    if (fs.existsSync(JSON_DB_FILE)) {
        try {
            const raw = fs.readFileSync(JSON_DB_FILE, 'utf8');
            localData = { ...localData, ...JSON.parse(raw) };
        } catch (e) {
            console.error('⚠️ Failed to load local JSON DB:', e.message);
        }
    } else {
        saveLocalDb();
    }
}

function saveLocalDb() {
    try {
        fs.writeFileSync(JSON_DB_FILE, JSON.stringify(localData, null, 2), 'utf8');
    } catch (e) {
        console.error('⚠️ Failed to save local JSON DB:', e.message);
    }
}

// Initialize database with all tables
export const initDatabase = async () => {
    let connection;
    try {
        connection = await pool.getConnection();
        console.log('✅ Database connected');
        
        await connection.query(`CREATE DATABASE IF NOT EXISTS slipzo`);
        await connection.query(`USE slipzo`);
        console.log('✅ Database selected');
        
        await connection.query(`
            CREATE TABLE IF NOT EXISTS users (
                id VARCHAR(36) PRIMARY KEY,
                email VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                name VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_email (email)
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS shops (
                id VARCHAR(36) PRIMARY KEY,
                user_id VARCHAR(36) NOT NULL,
                name VARCHAR(255) NOT NULL,
                address TEXT,
                phone VARCHAR(50),
                invoice_prefix VARCHAR(20) DEFAULT 'SLP',
                invoice_sequence INT DEFAULT 1001,
                invoice_format VARCHAR(50) DEFAULT 'PREFIX-DATE-SEQ',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                UNIQUE KEY unique_user_shop (user_id)
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS customers (
                id VARCHAR(36) PRIMARY KEY,
                user_id VARCHAR(36) NOT NULL,
                name VARCHAR(255) NOT NULL,
                phone VARCHAR(50),
                email VARCHAR(255),
                address TEXT,
                gstin VARCHAR(50),
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                INDEX idx_user_id (user_id),
                INDEX idx_phone (phone)
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS templates (
                id VARCHAR(36) PRIMARY KEY,
                user_id VARCHAR(36) NOT NULL,
                name VARCHAR(255) NOT NULL,
                width VARCHAR(20) DEFAULT '58mm',
                show_tax BOOLEAN DEFAULT TRUE,
                tax_rate DECIMAL(5,2) DEFAULT 18.00,
                footer TEXT,
                is_default BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                INDEX idx_user_id (user_id)
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS bills (
                id VARCHAR(36) PRIMARY KEY,
                user_id VARCHAR(36) NOT NULL,
                template_id VARCHAR(36) NOT NULL,
                customer_id VARCHAR(36),
                customer_name VARCHAR(255),
                customer_phone VARCHAR(50),
                number VARCHAR(50) UNIQUE NOT NULL,
                discount DECIMAL(10,2) DEFAULT 0.00,
                tax_rate DECIMAL(5,2) DEFAULT 0.00,
                payment_mode VARCHAR(50) DEFAULT 'Cash',
                shop_name VARCHAR(255) NOT NULL,
                shop_address TEXT,
                shop_phone VARCHAR(50),
                template_name VARCHAR(255),
                template_width VARCHAR(10) DEFAULT '58mm',
                subtotal DECIMAL(10,2) DEFAULT 0.00,
                tax_amount DECIMAL(10,2) DEFAULT 0.00,
                total DECIMAL(10,2) DEFAULT 0.00,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (template_id) REFERENCES templates(id),
                INDEX idx_user_id (user_id),
                INDEX idx_created_at (created_at),
                INDEX idx_number (number),
                INDEX idx_customer_id (customer_id)
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS bill_items (
                id VARCHAR(36) PRIMARY KEY,
                bill_id VARCHAR(36) NOT NULL,
                name VARCHAR(255) NOT NULL,
                quantity INT NOT NULL DEFAULT 1,
                rate DECIMAL(10,2) NOT NULL DEFAULT 0.00,
                amount DECIMAL(10,2) DEFAULT 0.00,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE,
                INDEX idx_bill_id (bill_id)
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS sessions (
                id VARCHAR(36) PRIMARY KEY,
                user_id VARCHAR(36) NOT NULL,
                token VARCHAR(500) NOT NULL,
                expires_at TIMESTAMP NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                INDEX idx_token (token),
                INDEX idx_expires_at (expires_at)
            )
        `);

        connection.release();
        isMySQLActive = true;
        console.log('✅ All MySQL database tables initialized successfully');
    } catch (error) {
        if (connection) {
            try { connection.release(); } catch (_) {}
        }
        isMySQLActive = false;
        loadLocalDb();
        console.warn('⚠️ MySQL not connected. Using local JSON database storage fallback.');
    }
};

// Helper for local JSON database operations
function executeLocalSql(sql, params = []) {
    loadLocalDb();
    const cleanSql = sql.trim().replace(/\s+/g, ' ');
    const lowerSql = cleanSql.toLowerCase();

    // SELECT
    if (lowerSql.startsWith('select')) {
        const tableMatch = cleanSql.match(/from\s+([a-z0-9_]+)/i);
        if (!tableMatch) return [];
        const table = tableMatch[1];
        let rows = [...(localData[table] || [])];

        // WHERE handling
        const whereMatch = cleanSql.match(/where\s+(.+?)(?:order\s+by|limit|$)/i);
        if (whereMatch) {
            const condClause = whereMatch[1].trim();
            const conditions = condClause.split(/\s+and\s+/i);
            const eqConditions = [];
            let paramIdx = 0;

            for (const cond of conditions) {
                const eqMatch = cond.match(/([a-z0-9_]+)\s*=\s*\?/i);
                if (eqMatch) {
                    eqConditions.push({ col: eqMatch[1], val: params[paramIdx++] });
                }
            }

            rows = rows.filter(row => {
                for (const { col, val } of eqConditions) {
                    if (row[col] != val) return false;
                }
                return true;
            });
        }

        // ORDER BY
        if (lowerSql.includes('order by')) {
            const orderMatch = cleanSql.match(/order\s+by\s+([a-z0-9_]+)(\s+desc|\s+asc)?/i);
            if (orderMatch) {
                const col = orderMatch[1];
                const isDesc = orderMatch[2] && orderMatch[2].trim().toLowerCase() === 'desc';
                rows.sort((a, b) => {
                    if (a[col] < b[col]) return isDesc ? 1 : -1;
                    if (a[col] > b[col]) return isDesc ? -1 : 1;
                    return 0;
                });
            }
        }

        return rows;
    }

    // INSERT
    if (lowerSql.startsWith('insert into')) {
        const match = cleanSql.match(/insert into\s+([a-z0-9_]+)\s*\(([^)]+)\)\s*values\s*\(([^)]+)\)/i);
        if (match) {
            const table = match[1];
            const cols = match[2].split(',').map(c => c.trim());
            const row = { created_at: new Date().toISOString() };
            cols.forEach((col, idx) => {
                row[col] = params[idx];
            });
            if (!localData[table]) localData[table] = [];

            // Duplicate email check for users
            if (table === 'users') {
                const dup = localData.users.find(u => u.email.toLowerCase() === row.email.toLowerCase());
                if (dup) {
                    const err = new Error('Email already registered');
                    err.code = 'ER_DUP_ENTRY';
                    throw err;
                }
            }

            localData[table].push(row);
            saveLocalDb();
            return { affectedRows: 1, insertId: row.id };
        }
    }

    // UPDATE
    if (lowerSql.startsWith('update')) {
        const tableMatch = cleanSql.match(/update\s+([a-z0-9_]+)\s+set/i);
        if (tableMatch) {
            const table = tableMatch[1];
            const rows = localData[table] || [];
            let affected = 0;

            const setMatch = cleanSql.match(/set\s+(.+?)\s+where\s+(.+)/i);
            if (setMatch) {
                const setClause = setMatch[1];
                const whereClause = setMatch[2];
                const setCols = setClause.split(',').map(s => s.split('=')[0].trim());

                let paramIdx = 0;
                const newVals = {};
                setCols.forEach(col => {
                    newVals[col] = params[paramIdx++];
                });

                const whereMatchCol = whereClause.match(/([a-z0-9_]+)\s*=\s*\?/i);
                if (whereMatchCol) {
                    const targetCol = whereMatchCol[1];
                    const targetVal = params[paramIdx];

                    rows.forEach(row => {
                        if (row[targetCol] == targetVal) {
                            Object.assign(row, newVals);
                            row.updated_at = new Date().toISOString();
                            affected++;
                        }
                    });
                }
            }
            saveLocalDb();
            return { affectedRows: affected };
        }
    }

    // DELETE
    if (lowerSql.startsWith('delete from')) {
        const match = cleanSql.match(/delete from\s+([a-z0-9_]+)\s+where\s+(.+)/i);
        if (match) {
            const table = match[1];
            const whereClause = match[2];
            const whereMatchCol = whereClause.match(/([a-z0-9_]+)\s*=\s*\?/i);
            if (whereMatchCol && localData[table]) {
                const col = whereMatchCol[1];
                const val = params[0];
                const origLen = localData[table].length;
                localData[table] = localData[table].filter(row => row[col] != val);
                const affected = origLen - localData[table].length;
                saveLocalDb();
                return { affectedRows: affected };
            }
        }
    }

    return [];
}

export const query = async (sql, params = []) => {
    if (isMySQLActive) {
        try {
            const [rows] = await pool.execute(sql, params);
            return rows;
        } catch (error) {
            console.warn('⚠️ MySQL query error, falling back to local storage:', error.message);
            isMySQLActive = false;
            return executeLocalSql(sql, params);
        }
    }
    return executeLocalSql(sql, params);
};

export const queryOne = async (sql, params = []) => {
    const rows = await query(sql, params);
    return rows[0] || null;
};

export const insert = async (table, data) => {
    if (isMySQLActive) {
        try {
            const keys = Object.keys(data);
            const values = Object.values(data);
            const placeholders = keys.map(() => '?').join(', ');
            const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`;
            const [result] = await pool.execute(sql, values);
            return result;
        } catch (error) {
            if (error.message === 'Email already registered' || error.code === 'ER_DUP_ENTRY') {
                throw error;
            }
            console.warn('⚠️ MySQL insert error, falling back to local storage:', error.message);
            isMySQLActive = false;
            return executeLocalSql(`INSERT INTO ${table} (${Object.keys(data).join(', ')}) VALUES (${Object.keys(data).map(() => '?').join(', ')})`, Object.values(data));
        }
    }
    return executeLocalSql(`INSERT INTO ${table} (${Object.keys(data).join(', ')}) VALUES (${Object.keys(data).map(() => '?').join(', ')})`, Object.values(data));
};

export const update = async (table, data, where, whereParams = []) => {
    if (isMySQLActive) {
        try {
            const keys = Object.keys(data);
            const setClause = keys.map(key => `${key} = ?`).join(', ');
            const values = [...Object.values(data), ...whereParams];
            const sql = `UPDATE ${table} SET ${setClause} WHERE ${where}`;
            const [result] = await pool.execute(sql, values);
            return result;
        } catch (error) {
            console.warn('⚠️ MySQL update error, falling back to local storage:', error.message);
            isMySQLActive = false;
            return executeLocalSql(`UPDATE ${table} SET ${Object.keys(data).map(k => `${k} = ?`).join(', ')} WHERE ${where}`, [...Object.values(data), ...whereParams]);
        }
    }
    return executeLocalSql(`UPDATE ${table} SET ${Object.keys(data).map(k => `${k} = ?`).join(', ')} WHERE ${where}`, [...Object.values(data), ...whereParams]);
};

export const deleteById = async (table, id) => {
    if (isMySQLActive) {
        try {
            const [result] = await pool.execute(`DELETE FROM ${table} WHERE id = ?`, [id]);
            return result.affectedRows > 0;
        } catch (error) {
            console.warn('⚠️ MySQL delete error, falling back to local storage:', error.message);
            isMySQLActive = false;
            return executeLocalSql(`DELETE FROM ${table} WHERE id = ?`, [id]);
        }
    }
    const res = executeLocalSql(`DELETE FROM ${table} WHERE id = ?`, [id]);
    return res.affectedRows > 0;
};

export const beginTransaction = async () => {
    if (isMySQLActive) {
        try {
            const connection = await pool.getConnection();
            await connection.beginTransaction();
            return connection;
        } catch (error) {
            isMySQLActive = false;
        }
    }
    return {
        query: async (sql, params = []) => query(sql, params),
        commit: async () => {},
        rollback: async () => {},
        release: () => {}
    };
};

export default { 
    pool, 
    query, 
    queryOne, 
    insert, 
    update, 
    deleteById, 
    initDatabase,
    beginTransaction
};