import ShopStaff from '../models/ShopStaff.js';
import User from '../models/User.js';
import { clearStaffCache, getStaffContext } from '../middleware/auth.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_STAFF_PER_SHOP = 20;

export const listStaff = async (req, res, next) => {
    try {
        res.json(await ShopStaff.listForOwner(req.user.id));
    } catch (err) {
        next(err);
    }
};

export const inviteStaff = async (req, res, next) => {
    try {
        const email = String(req.body.email || '').trim().toLowerCase();
        if (!EMAIL_REGEX.test(email)) {
            return res.status(400).json({ detail: 'Please enter a valid email address.' });
        }
        if (email === String(req.user.email || '').toLowerCase()) {
            return res.status(400).json({ detail: 'That is your own email. Add your worker\'s email instead.' });
        }
        if (!(await User.existsByEmail(email))) {
            return res.status(404).json({ detail: 'No Slipzo account found with this email. Ask your worker to sign up first, then add them again.' });
        }
        if (await ShopStaff.findByOwnerAndEmail(req.user.id, email)) {
            return res.status(409).json({ detail: 'This email has already been added.' });
        }
        if (await ShopStaff.countForOwner(req.user.id) >= MAX_STAFF_PER_SHOP) {
            return res.status(400).json({ detail: `A shop can have up to ${MAX_STAFF_PER_SHOP} workers.` });
        }
        const { member, code } = await ShopStaff.invite(req.user.id, email);
        res.status(201).json({ member, invite_code: code });
    } catch (err) {
        next(err);
    }
};

// Codes are stored hashed and shown once, so a lost or expired code is replaced rather than shown again
export const regenerateInvite = async (req, res, next) => {
    try {
        const row = await ShopStaff.findForOwner(req.params.id, req.user.id);
        if (!row) return res.status(404).json({ detail: 'Worker not found.' });
        if (row.status !== 'pending') {
            return res.status(400).json({ detail: 'This worker has already joined.' });
        }
        const { member, code } = await ShopStaff.regenerate(row);
        res.json({ member, invite_code: code });
    } catch (err) {
        next(err);
    }
};

export const revokeStaff = async (req, res, next) => {
    try {
        const row = await ShopStaff.findForOwner(req.params.id, req.user.id);
        if (!row) return res.status(404).json({ detail: 'Worker not found.' });
        await ShopStaff.remove(row.id);
        if (row.worker_user_id) clearStaffCache(row.worker_user_id);
        res.json({ success: true });
    } catch (err) {
        next(err);
    }
};

export const joinShop = async (req, res, next) => {
    try {
        const code = String(req.body.code || '').trim();
        if (!code) return res.status(400).json({ detail: 'Please enter your invite code.' });

        // An owner with workers joining another shop would leave those workers pointing at the wrong data
        if (await ShopStaff.hasActiveWorkers(req.user.id)) {
            return res.status(400).json({ detail: 'You have workers on your own shop. Remove them before joining another shop.' });
        }

        const result = await ShopStaff.join(req.user, code);
        if (result.error) return res.status(400).json({ detail: result.error });

        clearStaffCache(req.user.id);
        const owner = await User.findById(result.ownerId);
        res.json({ success: true, staff_of: { shop_name: owner?.shop?.name || owner?.name || 'Shop' } });
    } catch (err) {
        next(err);
    }
};

export const leaveShop = async (req, res, next) => {
    try {
        const worker = req.authUser;
        const membership = await ShopStaff.findActiveByWorker(worker.id);
        if (!membership) return res.status(400).json({ detail: 'You are not part of another shop.' });
        await ShopStaff.remove(membership.id);
        clearStaffCache(worker.id);
        res.json({ success: true, staff_of: await getStaffContext(worker.id) });
    } catch (err) {
        next(err);
    }
};
