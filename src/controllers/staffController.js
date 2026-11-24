import { v4 as uuidv4 } from 'uuid';
import ShopStaff from '../models/ShopStaff.js';
import User from '../models/User.js';
import Shop from '../models/Shop.js';
import Notification from '../models/Notification.js';
import PrintLedger from '../models/PrintLedger.js';
import { clearStaffCache, getStaffContext } from '../middleware/auth.js';
import { normalizePhone, phoneToEmail, phoneFromEmail, isPhoneEmail } from '../utils/phone.js';
import { query, queryOne, insert, update } from '../config/database.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_STAFF_PER_SHOP = 20;

export const listStaff = async (req, res, next) => {
    try {
        res.json(await ShopStaff.listForOwner(req.user.id));
    } catch (err) {
        next(err);
    }
};

/** GET /shop/staff/prints?from=<ISO of the shop's local midnight>: prints per person, today and in the last 30 days */
export const staffPrints = async (req, res, next) => {
    try {
        const now = Date.now();
        let from = new Date(String(req.query.from || '')).getTime();
        if (!Number.isFinite(from) || from > now || now - from > 25 * 60 * 60 * 1000) from = new Date().setHours(0, 0, 0, 0);
        const workers = await PrintLedger.byPerson(req.user.id, from);
        const sum = (key) => workers.reduce((n, w) => n + w[key], 0);
        res.json({ workers, today: sum('today'), month: sum('month') });
    } catch (err) {
        next(err);
    }
};

export const inviteStaff = async (req, res, next) => {
    try {
        // A worker is added by mobile number. An email still works for workers whose account was made with one.
        const entered = String(req.body.phone ?? req.body.email ?? '').trim();
        let email;
        let what;
        let phone = null;
        let account = null;
        let isNewUserCreated = false;
        let tempPassword = null;
        let toCreate = null;

        if (entered.includes('@')) {
            email = entered.toLowerCase();
            what = 'email';
            if (!EMAIL_REGEX.test(email)) {
                return res.status(400).json({ detail: 'Please enter a valid 10-digit mobile number or email.' });
            }
            account = await User.findByEmail(email);
            if (!account) {
                return res.status(404).json({
                    detail: 'No Slipzo account found with this email. Ask your worker to sign up first, then add them again.',
                    not_registered: true,
                    email
                });
            }
        } else {
            phone = normalizePhone(entered);
            if (!phone) {
                return res.status(400).json({ detail: 'Please enter a valid 10-digit mobile number.' });
            }
            what = 'mobile number';
            account = await User.findAccountForPhone(phone);

            // If account is not found, check if owner wants to register them as staff
            if (!account) {
                if (req.body.create_account || req.body.register) {
                    const workerName = String(req.body.name || '').trim();
                    if (!workerName) {
                        return res.status(400).json({ detail: "Please enter the staff member's name." });
                    }
                    const workerPassword = String(req.body.password || phone.slice(-6)).trim();
                    if (workerPassword.length < 4) {
                        return res.status(400).json({ detail: 'Password must be at least 4 characters long.' });
                    }

                    // created further down, after every check that can still refuse the worker
                    toCreate = { name: workerName, phone, password: workerPassword };
                } else {
                    // an error status: apps that do not know these fields took a 200 for "worker added"
                    return res.status(404).json({
                        detail: `No Slipzo account found with this mobile number. You can register them as a new staff member now.`,
                        not_registered: true,
                        requires_registration: true,
                        phone
                    });
                }
            }

            if (account && (account.id === req.user.id || account.id === req.authUser?.id)) {
                return res.status(400).json({ detail: `That is your own ${what}. Add your worker's ${what} instead.` });
            }
            email = String(account?.email || phoneToEmail(phone)).trim().toLowerCase();
        }

        if (email === String(req.user.email || '').toLowerCase()) {
            return res.status(400).json({ detail: `That is your own ${what}. Add your worker's ${what} instead.` });
        }

        if (await ShopStaff.findByOwnerAndEmail(req.user.id, email)) {
            return res.status(409).json({ detail: `This ${what} has already been added to your shop.` });
        }

        if (await ShopStaff.countForOwner(req.user.id) >= MAX_STAFF_PER_SHOP) {
            return res.status(400).json({ detail: `A shop can have up to ${MAX_STAFF_PER_SHOP} workers.` });
        }

        if (toCreate) {
            const newUser = await User.create(toCreate);
            // Create minimal default shop for new user so queries don't fail
            try {
                await Shop.create({ user_id: newUser.id, name: `${toCreate.name}'s Shop` });
            } catch (_) {}
            account = { id: newUser.id, email: newUser.email || phoneToEmail(phone), name: newUser.name };
            isNewUserCreated = true;
            tempPassword = toCreate.password;
        }
        const workerUserId = account.id;

        // Check if user is ALREADY staff of another shop OR owner of an active shop
        let isAlreadyStaffElsewhere = false;
        let isAlreadyOwner = false;

        if (workerUserId && !isNewUserCreated) {
            const activeStaffMembership = await ShopStaff.findActiveByWorker(workerUserId);
            if (activeStaffMembership && activeStaffMembership.owner_user_id !== req.user.id) {
                isAlreadyStaffElsewhere = true;
            }

            const hasActiveWorkers = await ShopStaff.hasActiveWorkers(workerUserId);
            // Someone who runs a shop of their own (bills, or a plan they bought) is invited and decides; they are never
            // switched over to this shop without being asked.
            let runsAShop = false;
            for (const table of ['print_bills', 'saved_bills', 'subscriptions', 'bills']) {
                if (runsAShop) break;
                runsAShop = Boolean(await queryOne(`SELECT id FROM ${table} WHERE user_id = ? LIMIT 1`, [workerUserId]).catch((err) => {
                    if (table === 'bills') return null; // the old table; newer databases may not have it
                    throw err;
                }));
            }
            if (hasActiveWorkers || runsAShop) {
                isAlreadyOwner = true;
            }
        }

        const ownerUser = await User.findById(req.user.id);
        const ownerShopName = ownerUser?.shop?.name || ownerUser?.name || 'A shop';

        // 1. IF USER IS ALREADY STAFF OR OWNER: Send Invitation with Push & In-App Notification!
        if (isAlreadyStaffElsewhere || isAlreadyOwner) {
            const { member, code } = await ShopStaff.invite(req.user.id, email);

            if (workerUserId) {
                const title = 'Staff Role Invitation';
                const body = `You are invited to role as staff by ${ownerShopName}. Use invite code: ${code}`;
                await Notification.addOnce(workerUserId, {
                    kind: 'staff_invite',
                    title,
                    body,
                    view: 'shop',
                    key: `staff_invite_${req.user.id}_${Date.now()}`,
                    push: true
                }).catch((err) => console.warn('Could not send staff invite notification:', err.message));
            }

            return res.status(201).json({
                member: {
                    ...member,
                    name: account.name || null
                },
                invite_code: code,
                is_invite: true,
                notification_sent: true,
                message: `Invitation sent! Because this user is already ${isAlreadyOwner ? 'a shop owner' : 'a staff member of another shop'}, an invitation notification with code ${code} was sent to their device.`
            });
        }

        // 2. NEW USER OR NORMAL REGISTERED USER: Add directly as Active Staff!
        const memberId = uuidv4();
        const nowStr = new Date().toISOString();
        const row = {
            id: memberId,
            owner_user_id: req.user.id,
            worker_user_id: workerUserId,
            email,
            status: 'active',
            created_at: nowStr,
            accepted_at: nowStr
        };
        try {
            await insert('shop_staff', row);
        } catch (err) {
            // not added after all: an account nobody was told about must not stay behind (its number would count as registered)
            if (isNewUserCreated) {
                await query('DELETE FROM shops WHERE user_id = ?', [workerUserId]).catch(() => {});
                await query('DELETE FROM users WHERE id = ?', [workerUserId]).catch(() => {});
            }
            throw err;
        }
        if (workerUserId) clearStaffCache(workerUserId);

        // Notify worker if already registered
        if (workerUserId && !isNewUserCreated) {
            const title = 'Added as Staff';
            const body = `You have been added as staff for ${ownerShopName}. You now have access to billing and printing.`;
            await Notification.addOnce(workerUserId, {
                kind: 'staff_added',
                title,
                body,
                view: 'dashboard',
                key: `staff_added_${req.user.id}_${Date.now()}`,
                push: true
            }).catch((err) => console.warn('Could not send staff added notification:', err.message));
        }

        const member = {
            id: memberId,
            email: isPhoneEmail(email) ? '' : email,
            phone: phone || phoneFromEmail(email),
            name: account.name || (isNewUserCreated ? req.body.name : null),
            status: 'active',
            invite_expired: false,
            created_at: nowStr,
            accepted_at: nowStr
        };

        return res.status(201).json({
            member,
            status: 'active',
            is_new: isNewUserCreated,
            temp_password: tempPassword,
            message: isNewUserCreated
                ? `Staff member registered and added to your shop! Password: ${tempPassword}`
                : `${account.name || 'Worker'} added as active staff!`
        });
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

        // Also notify the worker if known
        const workerAccount = await (member.phone ? User.findAccountForPhone(member.phone) : User.findByEmail(row.email));
        if (workerAccount?.id) {
            const ownerUser = await User.findById(req.user.id);
            const ownerShopName = ownerUser?.shop?.name || ownerUser?.name || 'A shop';
            await Notification.addOnce(workerAccount.id, {
                kind: 'staff_invite',
                title: 'New Staff Invite Code',
                body: `Your invite code to join ${ownerShopName} as staff is: ${code}`,
                view: 'shop',
                key: `staff_invite_${req.user.id}_${Date.now()}`,
                push: true
            }).catch(() => null);
        }

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

export const getMyInvitations = async (req, res, next) => {
    try {
        const worker = req.authUser || req.user;
        const email = String(worker.email || '').trim().toLowerCase();
        const rows = await query(`
            SELECT s.id, s.created_at, s.invite_expires_at,
                   u.name AS owner_name,
                   sh.name AS shop_name,
                   sh.phone AS shop_phone
            FROM shop_staff s
            JOIN users u ON u.id = s.owner_user_id
            LEFT JOIN shops sh ON sh.user_id = u.id
            WHERE LOWER(s.email) = ? 
              AND s.status = 'pending'
              AND s.invite_code_hash IS NOT NULL
              AND (s.invite_expires_at IS NULL OR s.invite_expires_at > CURRENT_TIMESTAMP)
            ORDER BY s.created_at DESC
        `, [email]);
        res.json(rows || []);
    } catch (err) {
        next(err);
    }
};

export const acceptInvitation = async (req, res, next) => {
    try {
        const worker = req.authUser || req.user;
        const email = String(worker.email || '').trim().toLowerCase();
        const invite = await queryOne(`
            SELECT s.*, sh.name AS shop_name, u.name AS owner_name
            FROM shop_staff s
            JOIN users u ON u.id = s.owner_user_id
            LEFT JOIN shops sh ON sh.user_id = u.id
            WHERE s.id = ? AND LOWER(s.email) = ? AND s.status = 'pending'
        `, [req.params.id, email]);

        if (!invite) {
            return res.status(404).json({ detail: 'Invitation not found or already accepted.' });
        }

        if (new Date(invite.invite_expires_at) < new Date()) {
            return res.status(400).json({ detail: 'This invitation has expired.' });
        }

        // If worker has their own workers
        if (await ShopStaff.hasActiveWorkers(worker.id)) {
            return res.status(400).json({ detail: 'You have workers on your own shop. Remove them before joining another shop.' });
        }

        // If worker is already a worker elsewhere, remove old membership
        const existingMembership = await ShopStaff.findActiveByWorker(worker.id);
        if (existingMembership) {
            await ShopStaff.remove(existingMembership.id);
        }

        const nowStr = new Date().toISOString();
        await update('shop_staff', {
            status: 'active',
            worker_user_id: worker.id,
            invite_code_hash: null,
            accepted_at: nowStr
        }, 'id = ?', [invite.id]);

        clearStaffCache(worker.id);

        res.json({
            success: true,
            staff_of: { shop_name: invite.shop_name || invite.owner_name || 'Shop', shop_id: invite.owner_user_id }
        });
    } catch (err) {
        next(err);
    }
};

export const joinShop = async (req, res, next) => {
    try {
        const worker = req.authUser || req.user;
        const code = String(req.body.code || '').trim();
        if (!code) return res.status(400).json({ detail: 'Please enter your invite code.' });

        // An owner with workers joining another shop would leave those workers pointing at the wrong data
        if (await ShopStaff.hasActiveWorkers(worker.id)) {
            return res.status(400).json({ detail: 'You have workers on your own shop. Remove them before joining another shop.' });
        }

        const existingMembership = await ShopStaff.findActiveByWorker(worker.id);
        if (existingMembership) {
            if (req.body.switch_shop) {
                await ShopStaff.remove(existingMembership.id);
                clearStaffCache(worker.id);
            } else {
                return res.status(400).json({
                    detail: 'You are already a worker for another shop. Leave it before joining, or confirm to switch shops.',
                    can_switch: true
                });
            }
        }

        const result = await ShopStaff.join(worker, code);
        if (result.error) return res.status(400).json({ detail: result.error });

        clearStaffCache(worker.id);
        const owner = await User.findById(result.ownerId);
        res.json({ success: true, staff_of: { shop_name: owner?.shop?.name || owner?.name || 'Shop', shop_id: result.ownerId } });
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
