import express from 'express';
import { authMiddleware, optionalAuth } from '../middleware/auth.js';
import Push from '../models/Push.js';
import { runPlanReminders } from '../services/planReminders.js';

const router = express.Router();

// The person who is signed in: a worker's phone is kept under the worker, not under the shop owner they work for
const ownId = (req) => req.authUser?.id || req.user?.id || null;

/**
 * POST /api/push/register { token, platform } - saves this phone's push token, for the account that is signed in or,
 * before sign in, without one. The account comes from the session only: an id in the request would let anybody
 * receive another shop's notifications.
 */
router.post('/register', optionalAuth, async (req, res, next) => {
    try {
        const userId = ownId(req) || Push.ANONYMOUS;
        const ok = await Push.registerToken(userId, req.body?.token, req.body?.platform);
        if (!ok) return res.status(400).json({ detail: 'Missing push token' });
        res.json({ ok: true, account: userId !== Push.ANONYMOUS });
    } catch (err) {
        next(err);
    }
});

/** POST /api/push/unregister { token } - on sign out, this phone stops getting this account's notifications */
router.post('/unregister', authMiddleware, async (req, res, next) => {
    try {
        await Push.removeToken(ownId(req), req.body?.token);
        res.json({ ok: true });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/push/cron/plan-reminders - daily plan reminders. Called by Vercel Cron (see vercel.json),
 * which sends "Authorization: Bearer <CRON_SECRET>". Refused without the right secret.
 */
router.get('/cron/plan-reminders', async (req, res, next) => {
    try {
        const secret = process.env.CRON_SECRET;
        if (!secret || req.get('authorization') !== `Bearer ${secret}`) {
            return res.status(401).json({ detail: 'Not allowed' });
        }
        res.json(await runPlanReminders({ notices: true }));
    } catch (err) {
        next(err);
    }
});

export default router;
