import { v4 as uuidv4 } from 'uuid';
import { query, queryOne, insert } from '../config/database.js';
import { sendPush, isPushConfigured } from '../utils/push.js';

const now = () => new Date().toISOString();

/**
 * Devices that get push notifications (one row per phone and account), what was already sent
 * (so a reminder goes out only once), and the messages the platform admin sent.
 */
export default class Push {
    /** Phones where nobody is signed in: they get announcements to everyone, nothing personal */
    static ANONYMOUS = 'anonymous';

    /** Saves this phone's FCM token for the signed-in user (a token moves to the newest account using it) */
    static async registerToken(userId, token, platform = 'android') {
        const clean = String(token || '').trim();
        if (!clean || clean.length > 4096) return false;
        // a request without a session (it ended, or is still starting) must not take the phone away from its account;
        // signing out does that itself (removeToken)
        if (userId === Push.ANONYMOUS) {
            const owned = await queryOne('SELECT id FROM push_tokens WHERE token = ?', [clean]);
            if (owned) {
                await query('UPDATE push_tokens SET updated_at = ? WHERE id = ?', [now(), owned.id]);
                return true;
            }
        }
        await query('DELETE FROM push_tokens WHERE token = ? AND user_id <> ?', [clean, userId]).catch(() => null);
        const existing = await queryOne('SELECT id FROM push_tokens WHERE token = ? AND user_id = ?', [clean, userId]);
        if (existing) {
            await query('UPDATE push_tokens SET updated_at = ? WHERE id = ?', [now(), existing.id]);
        } else {
            await insert('push_tokens', {
                id: uuidv4(),
                user_id: userId,
                token: clean,
                platform: String(platform || 'android').slice(0, 20),
                created_at: now(),
                updated_at: now()
            });
        }
        return true;
    }

    static async removeToken(userId, token) {
        await query('DELETE FROM push_tokens WHERE token = ? AND user_id = ?', [String(token || '').trim(), userId]).catch(() => null);
    }

    static async removeTokens(tokens) {
        for (const t of tokens || []) {
            await query('DELETE FROM push_tokens WHERE token = ?', [t]).catch(() => null);
        }
    }

    static async tokensForUser(userId) {
        const rows = await query('SELECT token FROM push_tokens WHERE user_id = ?', [userId]).catch(() => []);
        return (rows || []).map((r) => r.token);
    }

    /** Every user who has the app with notifications on: [{ user_id, token }] */
    static async allTokens() {
        return (await query('SELECT user_id, token FROM push_tokens').catch(() => [])) || [];
    }

    static async deviceCount() {
        const row = await queryOne('SELECT COUNT(*) AS devices, COUNT(DISTINCT user_id) AS users FROM push_tokens').catch(() => null);
        return { devices: Number(row?.devices || 0), users: Number(row?.users || 0) };
    }

    /** true the first time a key is seen for a user, false afterwards (a reminder is sent only once) */
    static async markOnce(userId, key) {
        const seen = await queryOne('SELECT id FROM push_log WHERE user_id = ? AND dedupe_key = ?', [userId, key]).catch(() => null);
        if (seen) return false;
        await insert('push_log', { id: uuidv4(), user_id: userId, dedupe_key: key, created_at: now() });
        return true;
    }

    /** Sends to one user's devices and forgets tokens that no longer work */
    static async sendToUser(userId, message) {
        const tokens = await Push.tokensForUser(userId);
        const res = await sendPush(tokens, message);
        if (res.deadTokens.length) await Push.removeTokens(res.deadTokens);
        return res;
    }

    /**
     * Platform admin message: an announcement, a discount offer or a plan reminder.
     * target: "all" or a user id. Saved with how many phones it reached.
     */
    static async sendAdminMessage({ title, body, kind = 'announcement', code = '', view = '', target = 'all', sentBy = 'admin' }) {
        const rows = target === 'all'
            ? await Push.allTokens()
            : ((await query('SELECT user_id, token FROM push_tokens WHERE user_id = ?', [target]).catch(() => [])) || []);
        const data = { kind, ...(code ? { code } : {}), ...(view ? { view } : {}) };
        // without Firebase it is still saved: users see it in the app's notification bell
        const res = isPushConfigured()
            ? await sendPush(rows.map((r) => r.token), { title, body, data })
            : { sent: 0, failed: 0, deadTokens: [], reasons: {} };
        if (res.deadTokens.length) await Push.removeTokens(res.deadTokens);
        const record = {
            id: uuidv4(),
            kind,
            title,
            body,
            code: code || null,
            target,
            users: new Set(rows.map((r) => r.user_id)).size,
            sent_count: res.sent,
            failed_count: res.failed,
            sent_by: sentBy,
            created_at: now()
        };
        await insert('push_messages', record).catch((err) => console.warn('⚠️ Could not save push message:', err.message));
        return { ...record, configured: isPushConfigured(), phones: new Set(rows.map((r) => r.token)).size, reasons: res.reasons || {} };
    }

    static async listMessages(limit = 50) {
        return (await query('SELECT * FROM push_messages ORDER BY created_at DESC LIMIT ?', [Math.max(1, Math.min(200, limit))]).catch(() => [])) || [];
    }
}
