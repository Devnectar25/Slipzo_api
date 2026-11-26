import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { query, queryOne } from '../config/database.js';

/**
 * Error monitoring for the admin panel. The same error is stored once (one row per fingerprint) and every repeat
 * only adds to its count and moves last_seen, so a loop that fires 10,000 times is still one line in the panel.
 * A resolved error that fires again opens again.
 */
let ready = null;
const ensureTable = () => {
    if (!ready) {
        ready = (async () => {
            await query(`CREATE TABLE IF NOT EXISTS error_logs (
                id TEXT PRIMARY KEY,
                fingerprint TEXT NOT NULL UNIQUE,
                source TEXT NOT NULL DEFAULT 'client',
                level TEXT NOT NULL DEFAULT 'error',
                message TEXT NOT NULL,
                stack TEXT,
                url TEXT,
                platform TEXT,
                user_agent TEXT,
                app_version TEXT,
                last_user_id TEXT,
                users_json TEXT NOT NULL DEFAULT '[]',
                count INTEGER NOT NULL DEFAULT 1,
                status TEXT NOT NULL DEFAULT 'open',
                first_seen TEXT NOT NULL,
                last_seen TEXT NOT NULL
            )`);
            await query('CREATE INDEX IF NOT EXISTS idx_error_logs_last_seen ON error_logs (last_seen)').catch(() => {});
        })().catch((err) => { ready = null; throw err; });
    }
    return ready;
};

const clip = (v, n) => (v === undefined || v === null ? null : String(v).slice(0, n));

/** The parts of a message that change between repeats (ids, numbers, links, quoted values) are blanked out */
export const normalizeMessage = (msg) => String(msg || '')
    .replace(/https?:\/\/[^\s'")]+/g, '<url>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<id>')
    .replace(/\b[0-9a-f]{16,}\b/gi, '<hex>')
    .replace(/(["'`]).{0,120}?\1/g, '<str>')
    .replace(/\d+(\.\d+)?/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400);

/** The first stack line that points at our own code, without line/column numbers (they move with every build) */
const topFrame = (stack) => {
    const lines = String(stack || '').split('\n').map((l) => l.trim()).filter((l) => /^at |@/.test(l));
    const own = lines.find((l) => !/node_modules|node:internal|<anonymous>|chrome-extension:/.test(l)) || lines[0] || '';
    return own
        .replace(/https?:\/\/[^/\s)]+/g, '')
        .replace(/-[A-Za-z0-9_]{6,}\.js/g, '.js') // vite file hashes: index-AbC123.js
        .replace(/:\d+(:\d+)?\)?$/g, '')
        .slice(0, 200);
};

export const fingerprintOf = ({ source, message, stack }) => crypto
    .createHash('sha1')
    .update(`${source}|${normalizeMessage(message)}|${topFrame(stack)}`)
    .digest('hex');

const toPublic = (r) => {
    let users = [];
    try { users = JSON.parse(r.users_json || '[]'); } catch (_) { }
    return {
        id: r.id,
        source: r.source,
        level: r.level,
        message: r.message,
        stack: r.stack,
        url: r.url,
        platform: r.platform,
        userAgent: r.user_agent,
        appVersion: r.app_version,
        lastUserId: r.last_user_id,
        affectedUsers: users.length,
        count: Number(r.count) || 0,
        status: r.status,
        firstSeen: r.first_seen,
        lastSeen: r.last_seen
    };
};

const ErrorLog = {
    /** Store one occurrence (or `times` occurrences reported together). Never throws: monitoring must not break the app. */
    async record({ source = 'client', level = 'error', message, stack, url, platform, userAgent, appVersion, userId, times = 1 }) {
        try {
            if (!message) return;
            await ensureTable();
            const fp = fingerprintOf({ source, message, stack });
            const now = new Date().toISOString();
            const n = Math.max(1, Math.min(Number(times) || 1, 10000));
            const existing = await queryOne('SELECT id, users_json FROM error_logs WHERE fingerprint = ?', [fp]);
            if (existing) {
                let users = [];
                try { users = JSON.parse(existing.users_json || '[]'); } catch (_) { }
                if (userId && !users.includes(String(userId)) && users.length < 500) users.push(String(userId));
                await query(
                    `UPDATE error_logs SET count = count + ?, last_seen = ?, status = 'open', url = COALESCE(?, url), platform = COALESCE(?, platform),
                     user_agent = COALESCE(?, user_agent), app_version = COALESCE(?, app_version), last_user_id = COALESCE(?, last_user_id),
                     users_json = ?, stack = COALESCE(stack, ?) WHERE id = ?`,
                    [n, now, clip(url, 500), clip(platform, 30), clip(userAgent, 300), clip(appVersion, 40), clip(userId, 80), JSON.stringify(users), clip(stack, 6000), existing.id]
                );
                return;
            }
            try {
                await query(
                    `INSERT INTO error_logs (id, fingerprint, source, level, message, stack, url, platform, user_agent, app_version, last_user_id, users_json, count, status, first_seen, last_seen)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
                    [uuidv4(), fp, clip(source, 20), clip(level, 20), clip(message, 2000), clip(stack, 6000), clip(url, 500), clip(platform, 30), clip(userAgent, 300),
                        clip(appVersion, 40), clip(userId, 80), JSON.stringify(userId ? [String(userId)] : []), n, now, now]
                );
            } catch (_) {
                // two reports of a new error arrived at the same moment: the other one made the row
                await query('UPDATE error_logs SET count = count + ?, last_seen = ? WHERE fingerprint = ?', [n, now, fp]).catch(() => { });
            }
        } catch (_) { /* never let monitoring fail a request */ }
    },

    async list({ status = 'open', source = 'all', search = '', sort = 'recent', limit = 200 } = {}) {
        await ensureTable();
        const where = [];
        const params = [];
        if (status === 'open' || status === 'resolved') { where.push('status = ?'); params.push(status); }
        if (source === 'client' || source === 'server') { where.push('source = ?'); params.push(source); }
        if (search) { where.push('(LOWER(message) LIKE ? OR LOWER(COALESCE(url, \'\')) LIKE ?)'); const q = `%${String(search).toLowerCase().slice(0, 100)}%`; params.push(q, q); }
        const order = sort === 'count' ? 'count DESC, last_seen DESC' : sort === 'first' ? 'first_seen DESC' : 'last_seen DESC';
        const rows = await query(
            `SELECT * FROM error_logs ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order} LIMIT ${Math.min(Math.max(Number(limit) || 200, 1), 500)}`,
            params
        );
        return rows.map(toPublic);
    },

    async summary() {
        await ensureTable();
        const dayAgo = new Date(Date.now() - 86400000).toISOString();
        const row = await queryOne(
            `SELECT
                SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open_count,
                SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) AS resolved_count,
                SUM(CASE WHEN status = 'open' THEN count ELSE 0 END) AS open_events,
                SUM(CASE WHEN last_seen >= ? THEN 1 ELSE 0 END) AS active_today,
                SUM(CASE WHEN first_seen >= ? THEN 1 ELSE 0 END) AS new_today
             FROM error_logs`,
            [dayAgo, dayAgo]
        );
        return {
            open: Number(row?.open_count) || 0,
            resolved: Number(row?.resolved_count) || 0,
            openEvents: Number(row?.open_events) || 0,
            activeToday: Number(row?.active_today) || 0,
            newToday: Number(row?.new_today) || 0
        };
    },

    async setStatus(id, status) {
        await ensureTable();
        const res = await query('UPDATE error_logs SET status = ? WHERE id = ?', [status === 'resolved' ? 'resolved' : 'open', id]);
        return (res?.changes ?? res?.rowCount ?? 0) > 0;
    },

    async remove(id) {
        await ensureTable();
        const res = await query('DELETE FROM error_logs WHERE id = ?', [id]);
        return (res?.changes ?? res?.rowCount ?? 0) > 0;
    },

    async removeResolved() {
        await ensureTable();
        const res = await query("DELETE FROM error_logs WHERE status = 'resolved'");
        return res?.changes ?? res?.rowCount ?? 0;
    }
};

export default ErrorLog;
