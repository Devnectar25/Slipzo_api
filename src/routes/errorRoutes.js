import express from 'express';
import { optionalAuth } from '../middleware/auth.js';
import ErrorLog from '../models/ErrorLog.js';

const router = express.Router();

// A broken page can fire errors in a loop: each device may send at most 30 reports a minute (each up to 20 errors).
const hits = new Map();
const allowed = (key) => {
    const now = Date.now();
    const h = hits.get(key);
    if (!h || now - h.start > 60000) { hits.set(key, { start: now, n: 1 }); return true; }
    h.n += 1;
    return h.n <= 30;
};
setInterval(() => { const cut = Date.now() - 120000; for (const [k, v] of hits) if (v.start < cut) hits.delete(k); }, 300000).unref?.();

/** The web app and the Android app report the errors their console saw. Signed-in or not. */
router.post('/', optionalAuth, async (req, res) => {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
    if (!allowed(ip)) return res.status(429).json({ detail: 'Too many error reports.' });
    const body = req.body || {};
    const list = Array.isArray(body.errors) ? body.errors.slice(0, 20) : [];
    const platform = ['web', 'android', 'ios'].includes(body.platform) ? body.platform : 'web';
    const userId = req.user?.ownerId || req.user?.id || req.userId || null;
    for (const e of list) {
        if (!e || typeof e.message !== 'string' || !e.message.trim()) continue;
        await ErrorLog.record({
            source: 'client',
            level: e.level === 'warning' ? 'warning' : 'error',
            message: e.message.slice(0, 2000),
            stack: typeof e.stack === 'string' ? e.stack : null,
            url: typeof e.url === 'string' ? e.url : null,
            platform,
            userAgent: req.headers['user-agent'],
            appVersion: typeof body.appVersion === 'string' ? body.appVersion : null,
            userId,
            times: e.count
        });
    }
    res.status(204).end();
});

export default router;
