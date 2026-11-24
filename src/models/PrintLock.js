import { query, queryOne, beginTransaction } from '../config/database.js';

/**
 * One account can be open on several devices (phone, computer, workers). Before a device prints it claims the bill
 * (or the restaurant table) here, so:
 *  - the same bill is never printed by two devices at the same moment,
 *  - two devices cannot both use the last print credit,
 *  - two devices cannot both sell the last pieces of an item.
 * A claim ends when the print is finished or cancelled, and by itself after CLAIM_MS (closed app, lost connection).
 * The row is kept afterwards as a note of which device printed the bill and when.
 */
export const CLAIM_MS = 2 * 60 * 1000;
const KEEP_MS = 3 * 24 * 60 * 60 * 1000;

let ready = null;
const ensureTable = () => {
    if (!ready) {
        ready = query(`CREATE TABLE IF NOT EXISTS print_locks (
            user_id TEXT NOT NULL,
            lock_key TEXT NOT NULL,
            holder TEXT,
            device TEXT,
            active INTEGER DEFAULT 0,
            expires_at BIGINT DEFAULT 0,
            credit INTEGER DEFAULT 0,
            reserved TEXT,
            printed_holder TEXT,
            printed_device TEXT,
            printed_at BIGINT,
            updated_at BIGINT DEFAULT 0,
            PRIMARY KEY (user_id, lock_key)
        )`).catch((err) => { ready = null; throw err; });
    }
    return ready;
};

const clean = (v, max) => String(v ?? '').trim().slice(0, max);
export const cleanHolder = (v) => clean(v, 80);
export const billKey = (id) => `bill:${clean(id, 80)}`;
export const tableKey = (id) => `table:${clean(id, 80).toLowerCase()}`;
const fail = (code, detail, extra = {}, status = 409) => ({ ok: false, status, body: { code, detail, ...extra } });

const parseReserved = (text) => {
    try { return Object.entries(JSON.parse(text || '{}')); } catch (_) { return []; }
};

export default class PrintLock {
    /** The note about a bill or table: who is printing it now, who printed it last. null when there is none. */
    static async info(userId, key) {
        try {
            await ensureTable();
            const row = await queryOne('SELECT * FROM print_locks WHERE user_id = ? AND lock_key = ?', [userId, key]);
            if (!row) return null;
            return { ...row, live: Number(row.active) === 1 && Number(row.expires_at) > Date.now(), printed_at: row.printed_at ? Number(row.printed_at) : null };
        } catch (err) {
            console.warn('⚠️ Print lock lookup failed:', err.message);
            return null;
        }
    }

    /** Another device is printing this right now (not the one asking) */
    static async busyElsewhere(userId, key, holder) {
        const info = await PrintLock.info(userId, key);
        return info?.live && info.holder !== holder ? info : null;
    }

    /**
     * Claims a bill or table for printing.
     * credit: this print will use one print credit (quota: what Subscription.getQuotaByUserId says)
     * stock: [{ id, name, qty, text }] the print will take out of stock (bills not printed yet, stock shops only)
     * Returns { ok: true, printed } or { ok: false, status, body }.
     */
    static async claim(userId, key, { holder, device, credit = false, quota = null, stock = [] }) {
        await ensureTable();
        const tx = await beginTransaction();
        try {
            // every claim of one account goes one after the other from here on (row lock on the account)
            await tx.query('UPDATE users SET prints_used = COALESCE(prints_used, 0) WHERE id = ?', [userId]);
            const now = Date.now();

            const [mine] = await tx.query('SELECT * FROM print_locks WHERE user_id = ? AND lock_key = ?', [userId, key]);
            if (mine && Number(mine.active) === 1 && Number(mine.expires_at) > now && mine.holder !== holder) {
                await tx.rollback();
                return fail('PRINTING_ELSEWHERE', 'This is being printed on another device right now. Please wait a moment.', {
                    device: mine.device || '',
                    retry_after: Math.ceil((Number(mine.expires_at) - now) / 1000)
                });
            }

            const others = await tx.query(
                'SELECT lock_key, credit, reserved FROM print_locks WHERE user_id = ? AND active = 1 AND expires_at > ? AND lock_key <> ?',
                [userId, now, key]
            );

            if (credit && quota && !quota.hasActiveTimePlan) {
                const [account] = await tx.query('SELECT prints_used FROM users WHERE id = ?', [userId]);
                const left = Number(quota.totalPrints || 0) - Number(account?.prints_used || 0);
                const promised = others.reduce((n, o) => n + (Number(o.credit) ? 1 : 0), 0);
                if (left - promised <= 0) {
                    await tx.rollback();
                    return left > 0
                        ? fail('LAST_CREDIT_IN_USE', 'Your last print credits are being used on another device right now.')
                        : fail('QUOTA_EXHAUSTED', 'No prints available in your print quota. Please purchase a plan to continue printing.', { quota: { ...quota, printsRemaining: 0, availablePrints: 0 } }, 403);
                }
            }

            const reserved = {};
            for (const want of stock) {
                const [row] = await tx.query('SELECT stock_qty FROM user_menu_items WHERE id = ? AND user_id = ?', [want.id, userId]);
                const promised = others.reduce((sum, o) => sum + parseReserved(o.reserved).reduce((s, [id, qty]) => s + (id === want.id ? Number(qty) || 0 : 0), 0), 0);
                const available = Math.round((Number(row?.stock_qty || 0) - promised) * 1000) / 1000;
                if (want.qty > available) {
                    await tx.rollback();
                    return fail('OUT_OF_STOCK', available <= 0
                        ? `"${want.name}" is out of stock`
                        : `Only ${want.text(available)} of "${want.name}" left in stock`);
                }
                reserved[want.id] = want.qty;
            }

            const values = [holder, clean(device, 60), now + CLAIM_MS, credit ? 1 : 0, JSON.stringify(reserved), now];
            if (mine) {
                await tx.query('UPDATE print_locks SET holder = ?, device = ?, active = 1, expires_at = ?, credit = ?, reserved = ?, updated_at = ? WHERE user_id = ? AND lock_key = ?', [...values, userId, key]);
            } else {
                await tx.query('INSERT INTO print_locks (holder, device, active, expires_at, credit, reserved, updated_at, user_id, lock_key) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)', [...values, userId, key]);
            }
            await tx.query('DELETE FROM print_locks WHERE user_id = ? AND active = 0 AND updated_at < ?', [userId, now - KEEP_MS]);
            await tx.commit();
            return {
                ok: true,
                printed: mine?.printed_at ? { holder: mine.printed_holder, device: mine.printed_device || '', at: Number(mine.printed_at) } : null
            };
        } catch (err) {
            await tx.rollback();
            throw err;
        } finally {
            tx.release();
        }
    }

    /** The print is over. printed: remember that this device printed it. Only the device that claimed can release. */
    static async release(userId, key, holder, { printed = false, device = '' } = {}) {
        try {
            await ensureTable();
            const now = Date.now();
            if (printed) {
                const res = await query(
                    "UPDATE print_locks SET printed_holder = ?, printed_device = COALESCE(NULLIF(?, ''), device), printed_at = ?, updated_at = ? WHERE user_id = ? AND lock_key = ?",
                    [holder, clean(device, 60), now, now, userId, key]
                );
                if (!Number(res?.affectedRows || 0)) {
                    await query(
                        'INSERT INTO print_locks (user_id, lock_key, holder, device, active, expires_at, credit, printed_holder, printed_device, printed_at, updated_at) VALUES (?, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?)',
                        [userId, key, holder, clean(device, 60), holder, clean(device, 60), now, now]
                    ).catch(() => {});
                }
            }
            await query('UPDATE print_locks SET active = 0, credit = 0, reserved = NULL, updated_at = ? WHERE user_id = ? AND lock_key = ? AND holder = ?', [now, userId, key, holder]);
        } catch (err) {
            console.warn('⚠️ Print lock release failed:', err.message);
        }
    }

    /** The credit this claim was holding has now really been used */
    static async creditUsed(userId, key, holder) {
        try {
            await query('UPDATE print_locks SET credit = 0 WHERE user_id = ? AND lock_key = ? AND holder = ?', [userId, key, holder]);
        } catch (_) { /* the claim ends by itself */ }
    }
}
