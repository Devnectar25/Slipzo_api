import bcryptjs from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { query, queryOne } from '../config/database.js';

/**
 * Admin panel accounts made by the super admin. Each one opens only the pages it was given (permissions) and can be
 * turned off at any time. The super admin itself stays the account set in the server's environment.
 */
export const ADMIN_PAGES = [
    'overview', 'users', 'grant_credits', 'plan_buyers', 'plans', 'products', 'menu', 'templates', 'bills',
    'contacts', 'notifications', 'errors'
];

let ready = null;
const ensureTable = () => {
    if (!ready) {
        ready = (async () => {
            await query(`CREATE TABLE IF NOT EXISTS sub_admins (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                username TEXT,
                phone TEXT,
                bio TEXT,
                password_hash TEXT NOT NULL,
                permissions TEXT NOT NULL DEFAULT '[]',
                active INTEGER NOT NULL DEFAULT 1,
                created_by TEXT,
                created_at TEXT,
                updated_at TEXT,
                last_login_at TEXT
            )`);
            for (const col of ['username TEXT', 'phone TEXT', 'bio TEXT']) {
                await query(`ALTER TABLE sub_admins ADD COLUMN ${col}`).catch(() => {});
            }
        })().catch((err) => { ready = null; throw err; });
    }
    return ready;
};

export const cleanPermissions = (list) => {
    // 'system' (System Health) was replaced by the Error Monitor: whoever had it now has 'errors'
    const wanted = Array.isArray(list) ? list.map((p) => (String(p) === 'system' ? 'errors' : String(p))) : [];
    const pages = ADMIN_PAGES.filter((p) => wanted.includes(p));
    // giving credits happens on the Users & Shops page
    return pages.includes('grant_credits') && !pages.includes('users') ? pages.filter((p) => p !== 'grant_credits') : pages;
};

const parse = (text) => {
    try { return cleanPermissions(JSON.parse(text || '[]')); } catch (_) { return []; }
};

/** What the admin panel may see of a sub-admin (never the password) */
const toPublic = (row) => row && ({
    id: row.id,
    name: row.name,
    email: row.email,
    username: row.username || '',
    phone: row.phone || '',
    bio: row.bio || '',
    permissions: parse(row.permissions),
    active: Number(row.active) === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_login_at: row.last_login_at
});

export default class SubAdmin {
    static async list() {
        await ensureTable();
        const rows = await query('SELECT * FROM sub_admins ORDER BY created_at DESC');
        return (rows || []).map(toPublic);
    }

    static async findById(id) {
        await ensureTable();
        return toPublic(await queryOne('SELECT * FROM sub_admins WHERE id = ?', [id]));
    }

    static async findRowById(id) {
        await ensureTable();
        return await queryOne('SELECT * FROM sub_admins WHERE id = ?', [id]);
    }

    static async findRowByEmail(email) {
        await ensureTable();
        return await queryOne('SELECT * FROM sub_admins WHERE LOWER(email) = ?', [String(email || '').trim().toLowerCase()]);
    }

    static async findRowByUsername(username) {
        await ensureTable();
        const clean = String(username || '').trim().toLowerCase();
        if (!clean) return null;
        return await queryOne('SELECT * FROM sub_admins WHERE LOWER(username) = ?', [clean]);
    }

    static async create({ name, email, username, phone, bio, password, permissions, createdBy }) {
        await ensureTable();
        const now = new Date().toISOString();
        const row = {
            id: uuidv4(),
            name: String(name).trim(),
            email: String(email).trim().toLowerCase(),
            username: username ? String(username).trim().toLowerCase() : '',
            phone: phone ? String(phone).trim() : '',
            bio: bio ? String(bio).trim() : '',
            password_hash: await bcryptjs.hash(password, 10),
            permissions: JSON.stringify(cleanPermissions(permissions)),
            active: 1,
            created_by: createdBy || null,
            created_at: now,
            updated_at: now
        };
        await query(
            'INSERT INTO sub_admins (id, name, email, username, phone, bio, password_hash, permissions, active, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [row.id, row.name, row.email, row.username, row.phone, row.bio, row.password_hash, row.permissions, row.active, row.created_by, row.created_at, row.updated_at]
        );
        return toPublic(row);
    }

    static async update(id, { name, email, username, phone, bio, permissions, active, password }) {
        await ensureTable();
        const sets = [];
        const params = [];
        if (name !== undefined) { sets.push('name = ?'); params.push(String(name).trim()); }
        if (email !== undefined) { sets.push('email = ?'); params.push(String(email).trim().toLowerCase()); }
        if (username !== undefined) { sets.push('username = ?'); params.push(String(username || '').trim().toLowerCase()); }
        if (phone !== undefined) { sets.push('phone = ?'); params.push(String(phone || '').trim()); }
        if (bio !== undefined) { sets.push('bio = ?'); params.push(String(bio || '').trim()); }
        if (permissions !== undefined) { sets.push('permissions = ?'); params.push(JSON.stringify(cleanPermissions(permissions))); }
        if (active !== undefined) { sets.push('active = ?'); params.push(active ? 1 : 0); }
        if (password !== undefined) { sets.push('password_hash = ?'); params.push(await bcryptjs.hash(password, 10)); }
        if (!sets.length) return SubAdmin.findById(id);
        sets.push('updated_at = ?');
        params.push(new Date().toISOString(), id);
        await query(`UPDATE sub_admins SET ${sets.join(', ')} WHERE id = ?`, params);
        return SubAdmin.findById(id);
    }

    static async remove(id) {
        await ensureTable();
        await query('DELETE FROM sub_admins WHERE id = ?', [id]);
    }

    static async verifyPassword(id, password) {
        const row = await SubAdmin.findRowById(id);
        if (!row || Number(row.active) !== 1) return false;
        return bcryptjs.compare(String(password || ''), row.password_hash);
    }

    /** The account for these login details (email or username), when it exists, is on and the password is right; else null */
    static async checkLogin(loginInput, password) {
        await ensureTable();
        const clean = String(loginInput || '').trim().toLowerCase();
        if (!clean) return null;
        const row = await queryOne(
            'SELECT * FROM sub_admins WHERE LOWER(email) = ? OR (username IS NOT NULL AND username != ? AND LOWER(username) = ?)',
            [clean, '', clean]
        );
        if (!row || Number(row.active) !== 1) return null;
        if (!(await bcryptjs.compare(String(password || ''), row.password_hash))) return null;
        const now = new Date().toISOString();
        await query('UPDATE sub_admins SET last_login_at = ? WHERE id = ?', [now, row.id]).catch(() => {});
        return toPublic({ ...row, last_login_at: now });
    }
}
