import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import Push from '../models/Push.js';
import { runPlanReminders } from '../services/planReminders.js';

const router = express.Router();

/** POST /api/push/register { token, platform } - the app saves this phone's push token after sign in */
router.post('/register', authMiddleware, async (req, res, next) => {
    try {
        const ok = await Push.registerToken(req.user.id, req.body?.token, req.body?.platform);
        if (!ok) return res.status(400).json({ detail: 'Missing push token' });
        res.json({ ok: true });
    } catch (err) {
        next(err);
    }
});

/** POST /api/push/unregister { token } - on sign out, this phone stops getting this account's notifications */
router.post('/unregister', authMiddleware, async (req, res, next) => {
    try {
        await Push.removeToken(req.user.id, req.body?.token);
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
        res.json(await runPlanReminders());
    } catch (err) {
        next(err);
    }
});

export default router;
