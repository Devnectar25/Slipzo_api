import crypto from 'crypto';
import bcryptjs from 'bcryptjs';
import { query, queryOne } from '../config/database.js';
import { isProduction } from '../config/security.js';

const SUPER_ADMIN_ID = 'super-admin';

const defaultSuperEmail = () => (process.env.ADMIN_EMAIL || 'admin@slipzo.com').toLowerCase().trim();
const defaultSuperPassword = () => {
    const envPass = process.env.ADMIN_PASSWORD ? String(process.env.ADMIN_PASSWORD).trim() : '';
    if (envPass) return envPass;
    if (isProduction()) {
        const generated = crypto.randomBytes(18).toString('base64url');
        console.warn('⚠️ [security] ADMIN_PASSWORD not set on initial seed in production; generated random password. Set ADMIN_PASSWORD or update via DB.');
        return generated;
    }
    return 'Admin@12345';
};
const defaultSuperName = () => (process.env.ADMIN_NAME || 'Super Admin').trim();
const defaultSuperUsername = () => (process.env.ADMIN_USERNAME || 'admin').toLowerCase().trim();

let tableReady = null;
const ensureTable = () => {
    if (!tableReady) {
        tableReady = (async () => {
            await query(`CREATE TABLE IF NOT EXISTS admin_profiles (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                username TEXT,
                phone TEXT,
                bio TEXT,
                password_hash TEXT NOT NULL,
                password_changed_at TEXT,
                created_at TEXT,
                updated_at TEXT,
                last_login_at TEXT
            )`);
            for (const col of ['username TEXT', 'phone TEXT', 'bio TEXT', 'password_changed_at TEXT', 'created_at TEXT', 'updated_at TEXT', 'last_login_at TEXT']) {
                await query(`ALTER TABLE admin_profiles ADD COLUMN ${col}`).catch(() => {});
            }
        })().catch((err) => {
            tableReady = null;
            throw err;
        });
    }
    return tableReady;
};

const toPublic = (row) => row && ({
    id: row.id,
    name: row.name,
    email: row.email,
    username: row.username || '',
    phone: row.phone || '',
    bio: row.bio || '',
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    last_login_at: row.last_login_at || null
});

let seedPromise = null;
const ensureSeededSuperAdmin = async () => {
    await ensureTable();
    const existing = await queryOne('SELECT * FROM admin_profiles WHERE id = ?', [SUPER_ADMIN_ID]);
    if (existing) return existing;

    if (!seedPromise) {
        seedPromise = (async () => {
            const again = await queryOne('SELECT * FROM admin_profiles WHERE id = ?', [SUPER_ADMIN_ID]);
            if (again) return again;

            const now = new Date().toISOString();
            const row = {
                id: SUPER_ADMIN_ID,
                name: defaultSuperName(),
                email: defaultSuperEmail(),
                username: defaultSuperUsername(),
                phone: '',
                bio: 'Platform Super Administrator',
                password_hash: await bcryptjs.hash(defaultSuperPassword(), 10),
                created_at: now,
                updated_at: now,
                last_login_at: null
            };
            await query(
                `INSERT INTO admin_profiles (id, name, email, username, phone, bio, password_hash, created_at, updated_at, last_login_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [row.id, row.name, row.email, row.username, row.phone, row.bio, row.password_hash, row.created_at, row.updated_at, row.last_login_at]
            ).catch(async () => {
                // ignore race if another concurrent call inserted first
            });
            return await queryOne('SELECT * FROM admin_profiles WHERE id = ?', [SUPER_ADMIN_ID]);
        })().finally(() => {
            seedPromise = null;
        });
    }
    return seedPromise;
};

export default class AdminProfile {
    static async getSuperAdmin({ withHash = false, withAuthMeta = false } = {}) {
        const row = await ensureSeededSuperAdmin();
        if (!row) return null;
        return {
            ...toPublic(row),
            ...(withHash ? { password_hash: row.password_hash } : {}),
            ...(withAuthMeta ? { password_changed_at: row.password_changed_at || null } : {})
        };
    }

    static async matchesSuperLogin(loginInput) {
        const clean = String(loginInput || '').toLowerCase().trim();
        if (!clean) return false;
        const row = await ensureSeededSuperAdmin();
        if (!row) return false;
        return (
            String(row.email || '').toLowerCase().trim() === clean ||
            (Boolean(row.username) && String(row.username).toLowerCase().trim() === clean)
        );
    }

    static async checkSuperLogin(loginInput, password) {
        const matches = await AdminProfile.matchesSuperLogin(loginInput);
        if (!matches) return null;
        const row = await ensureSeededSuperAdmin();
        const valid = await bcryptjs.compare(String(password || ''), row.password_hash);
        if (!valid) return null;
        const now = new Date().toISOString();
        await query('UPDATE admin_profiles SET last_login_at = ? WHERE id = ?', [now, SUPER_ADMIN_ID]).catch(() => {});
        return toPublic({ ...row, last_login_at: now });
    }

    static async verifySuperPassword(password) {
        const row = await ensureSeededSuperAdmin();
        if (!row) return false;
        return bcryptjs.compare(String(password || ''), row.password_hash);
    }

    static async updateSuperProfile({ name, email, username, phone, bio }) {
        await ensureSeededSuperAdmin();
        const sets = [];
        const params = [];
        if (name !== undefined) { sets.push('name = ?'); params.push(String(name).trim()); }
        if (email !== undefined) { sets.push('email = ?'); params.push(String(email).trim().toLowerCase()); }
        if (username !== undefined) { sets.push('username = ?'); params.push(String(username).trim().toLowerCase()); }
        if (phone !== undefined) { sets.push('phone = ?'); params.push(String(phone || '').trim()); }
        if (bio !== undefined) { sets.push('bio = ?'); params.push(String(bio || '').trim()); }
        if (!sets.length) return AdminProfile.getSuperAdmin();

        sets.push('updated_at = ?');
        params.push(new Date().toISOString(), SUPER_ADMIN_ID);
        await query(`UPDATE admin_profiles SET ${sets.join(', ')} WHERE id = ?`, params);
        return AdminProfile.getSuperAdmin();
    }

    static async changeSuperPassword(newPassword) {
        await ensureSeededSuperAdmin();
        const hash = await bcryptjs.hash(String(newPassword), 10);
        const now = new Date().toISOString();
        await query(
            'UPDATE admin_profiles SET password_hash = ?, password_changed_at = ?, updated_at = ? WHERE id = ?',
            [hash, now, now, SUPER_ADMIN_ID]
        );
        return AdminProfile.getSuperAdmin({ withAuthMeta: true });
    }
}
