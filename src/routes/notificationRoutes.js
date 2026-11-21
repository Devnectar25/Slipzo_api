import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import Notification from '../models/Notification.js';
import User from '../models/User.js';

const router = express.Router();
router.use(authMiddleware);

/** GET /api/notifications - the bell: newest notifications and how many are unread */
router.get('/', async (req, res, next) => {
    try {
        const userId = req.user.id;
        await Notification.refreshStatus(userId);
        let since = req.user.created_at || null;
        if (!since) {
            const u = await User.findById(userId).catch(() => null);
            since = u?.created_at || null;
        }
        res.json(await Notification.list(userId, { since }));
    } catch (err) {
        next(err);
    }
});

/** POST /api/notifications/read - the list was opened: everything is read */
router.post('/read', async (req, res, next) => {
    try {
        res.json(await Notification.markAllRead(req.user.id));
    } catch (err) {
        next(err);
    }
});

export default router;
