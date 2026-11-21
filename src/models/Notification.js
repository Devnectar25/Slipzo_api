import { v4 as uuidv4 } from 'uuid';
import { query, queryOne, insert, update } from '../config/database.js';
import Subscription from './Subscription.js';
import Shop from './Shop.js';
import UserMenuItem from './UserMenuItem.js';
import { isInventoryType } from './Inventory.js';
import { reminderFor } from '../services/planReminders.js';

/**
 * In-app notifications (the bell in the app header).
 * - Messages from the platform admin: read from push_messages (sent to everyone, or to this user).
 * - The user's own notices (plan ending, prints running low, low stock, UPI ID missing): user_notifications,
 *   each added once (dedupe_key).
 * Read state: everything newer than notification_state.seen_at is unread.
 */

const STATUS_EVERY_MS = 10 * 60 * 1000; // own notices are re-checked at most every 10 minutes per user
const lastStatusCheck = new Map();

const toTime = (v) => {
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? t : 0;
};

export default class Notification {
    /** Adds a notice for the user unless one with the same key already exists */
    static async addOnce(userId, { kind, title, body, view = null, key }) {
        const exists = await queryOne('SELECT id FROM user_notifications WHERE user_id = ? AND dedupe_key = ?', [userId, key]).catch(() => null);
        if (exists) return false;
        await insert('user_notifications', {
            id: uuidv4(),
            user_id: userId,
            kind,
            title: String(title).slice(0, 120),
            body: String(body).slice(0, 500),
            view,
            dedupe_key: key,
            created_at: new Date().toISOString()
        }).catch(() => null); // a parallel request may have added it first (unique key)
        return true;
    }

    /** Plan, prints, stock and UPI notices that apply right now (each kept once) */
    static async refreshStatus(userId) {
        const last = lastStatusCheck.get(userId) || 0;
        if (Date.now() - last < STATUS_EVERY_MS) return;
        lastStatusCheck.set(userId, Date.now());

        // plan ending / ended, prints low / used up (same wording as the push reminders)
        try {
            const quota = await Subscription.getQuotaByUserId(userId);
            const r = reminderFor(quota);
            if (r) await Notification.addOnce(userId, { kind: 'plan_reminder', title: r.title, body: r.body, view: 'pricing', key: r.key });
        } catch (err) {
            console.warn('⚠️ Plan notice:', err.message);
        }

        try {
            const shop = await Shop.findByUserId(userId);
            // UPI is on but there is no UPI ID, so bills cannot show a payment QR
            if (shop && (shop.payment_modes || []).includes('UPI') && !shop.upi_id) {
                await Notification.addOnce(userId, {
                    kind: 'setup',
                    title: 'Add your UPI ID',
                    body: 'UPI is on for your bills but no UPI ID is set, so customers cannot scan a payment QR. Add it in Shop profile.',
                    view: 'shop',
                    key: 'upi_missing'
                });
            }
            // stock running low (shops that keep stock), at most once a day
            if (shop && isInventoryType(shop.business_type)) {
                const items = await UserMenuItem.findByUserId(userId, '', 'all', '');
                const tracked = items.filter((it) => it.track_stock && it.stock_qty !== null);
                const out = tracked.filter((it) => Number(it.stock_qty) <= 0);
                const low = tracked.filter((it) => Number(it.stock_qty) > 0 && Number(it.stock_qty) <= Number(it.low_stock_alert || 0));
                if (out.length || low.length) {
                    const names = [...out, ...low].slice(0, 3).map((it) => it.name).join(', ');
                    const more = out.length + low.length > 3 ? ` and ${out.length + low.length - 3} more` : '';
                    await Notification.addOnce(userId, {
                        kind: 'stock',
                        title: out.length ? `${out.length} item${out.length > 1 ? 's' : ''} out of stock` : `${low.length} item${low.length > 1 ? 's' : ''} running low`,
                        body: `${names}${more}. Restock from the Item page.`,
                        view: 'menu',
                        key: `stock:${new Date().toISOString().slice(0, 10)}`
                    });
                }
            }
        } catch (err) {
            console.warn('⚠️ Shop notice:', err.message);
        }
    }

    /** Newest first: { items: [{ id, kind, title, body, code, view, created_at, unread }], unread } */
    static async list(userId, { since = null, limit = 40 } = {}) {
        const [own, admin, state] = await Promise.all([
            query('SELECT id, kind, title, body, view, created_at FROM user_notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?', [userId, limit]).catch(() => []),
            query("SELECT id, kind, title, body, code, created_at FROM push_messages WHERE target = 'all' OR target = ? ORDER BY created_at DESC LIMIT ?", [userId, limit]).catch(() => []),
            queryOne('SELECT seen_at FROM notification_state WHERE user_id = ?', [userId]).catch(() => null)
        ]);
        const seenAt = toTime(state?.seen_at);
        const sinceTime = since ? toTime(since) : 0;
        const items = [
            ...(own || []).map((n) => ({ id: `u_${n.id}`, kind: n.kind, title: n.title, body: n.body, code: null, view: n.view || null, created_at: n.created_at, from: 'slipzen' })),
            // admin messages sent before the account existed are not shown
            ...(admin || []).filter((m) => toTime(m.created_at) >= sinceTime).map((m) => ({
                id: `a_${m.id}`,
                kind: m.kind,
                title: m.title,
                body: m.body,
                code: m.code || null,
                view: m.kind === 'announcement' ? null : 'pricing',
                created_at: m.created_at,
                from: 'admin'
            }))
        ]
            .sort((a, b) => toTime(b.created_at) - toTime(a.created_at))
            .slice(0, limit)
            .map((n) => ({ ...n, unread: toTime(n.created_at) > seenAt }));
        return { items, unread: items.filter((n) => n.unread).length };
    }

    /** Opening the list marks everything as read */
    static async markAllRead(userId) {
        const now = new Date().toISOString();
        const row = await queryOne('SELECT user_id FROM notification_state WHERE user_id = ?', [userId]).catch(() => null);
        if (row) await update('notification_state', { seen_at: now }, 'user_id = ?', [userId]);
        else await insert('notification_state', { user_id: userId, seen_at: now });
        return { seen_at: now };
    }
}
