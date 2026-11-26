import express from 'express';
import Subscription from '../models/Subscription.js';
import jwt from 'jsonwebtoken';
import { adminAuthMiddleware, adminCan, superAdminOnly, forgetSubAdmin, forgetSuperAdmin } from '../middleware/adminAuth.js';
import SubAdmin, { ADMIN_PAGES } from '../models/SubAdmin.js';
import AdminProfile from '../models/AdminProfile.js';
import { query, queryOne, supabase, isPostgres } from '../config/database.js';
import ContactSubmission from '../models/ContactSubmission.js';
import MenuItem from '../models/MenuItem.js';
import { getAdminPlans, createPlan, updatePlan, deletePlan } from '../controllers/planController.js';
import Push from '../models/Push.js';
import ErrorLog from '../models/ErrorLog.js';
import { isPushConfigured } from '../utils/push.js';
import { getJwtSecret, getAdminCookieOptions, adminLoginLimiter } from '../config/security.js';
import { processUploadImage, sanitizeAssetUrl } from '../utils/imageUpload.js';

const router = express.Router();

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@slipzo.com').toLowerCase().trim();
const USERNAME_REGEX = /^[a-zA-Z0-9._-]{3,40}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const formatAdminResponse = (a) => ({
    id: a.id || (a.isSuper ? 'super-admin' : null),
    name: a.name || (a.isSuper ? 'Super Admin' : null),
    email: a.email,
    username: a.username || '',
    phone: a.phone || '',
    bio: a.bio || '',
    role: a.isSuper ? 'Super Admin' : 'Sub Admin',
    isSuper: Boolean(a.isSuper),
    permissions: a.isSuper ? ADMIN_PAGES : (a.permissions || []),
    loginTime: a.loginTime || null,
    lastLoginAt: a.lastLoginAt || a.last_login_at || null,
    updatedAt: a.updatedAt || a.updated_at || null
});

const issueAdminCookie = (res, payload) => {
    const token = jwt.sign(payload, getJwtSecret(), { expiresIn: '1d' });
    res.cookie('slipzo_admin_token', token, {
        ...getAdminCookieOptions(),
        maxAge: 24 * 60 * 60 * 1000
    });
    return token;
};

// Admin Login Endpoint (supports Email or Username for both Super Admin and Sub-admins)
router.post('/login', adminLoginLimiter, async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ detail: 'Email/Username and Password are required' });
        }

        const inputLogin = String(email).toLowerCase().trim();
        const inputPass = String(password).trim();
        const loginTime = new Date().toISOString();

        const isSuperTarget = await AdminProfile.matchesSuperLogin(inputLogin);
        if (isSuperTarget) {
            const superAdmin = await AdminProfile.checkSuperLogin(inputLogin, inputPass);
            if (!superAdmin) {
                return res.status(401).json({ detail: 'Invalid Admin credentials' });
            }
            const superMeta = await AdminProfile.getSuperAdmin({ withAuthMeta: true }).catch(() => null);
            const token = issueAdminCookie(res, {
                isAdmin: true,
                email: superAdmin.email,
                role: 'Super Admin',
                loginTime,
                sv: superMeta?.password_changed_at || null
            });
            return res.json({
                detail: 'Admin login successful',
                token,
                admin: formatAdminResponse({ ...superAdmin, isSuper: true, loginTime })
            });
        }

        const sub = await SubAdmin.checkLogin(inputLogin, inputPass).catch(() => null);
        if (!sub) {
            return res.status(401).json({ detail: 'Invalid Admin credentials' });
        }

        const subAuth = await SubAdmin.findAuthById(sub.id).catch(() => null);
        const subToken = issueAdminCookie(res, {
            isAdmin: true,
            subAdminId: sub.id,
            email: sub.email,
            role: 'Sub Admin',
            loginTime,
            sv: subAuth?.password_changed_at || null
        });

        return res.json({
            detail: 'Admin login successful',
            token: subToken,
            admin: formatAdminResponse({ ...sub, isSuper: false, loginTime })
        });
    } catch (err) {
        console.error('❌ Admin login error:', err);
        return res.status(500).json({ detail: 'Internal server error during admin login' });
    }
});

// Get Current Admin Session
router.get('/me', adminAuthMiddleware, (req, res) => {
    return res.json({
        admin: formatAdminResponse(req.admin)
    });
});

// Update Current Admin Profile (name, username, email, phone, bio)
router.put('/profile', adminAuthMiddleware, async (req, res) => {
    try {
        const body = req.body || {};
        const name = String(body.name || '').trim();
        const email = String(body.email || '').trim().toLowerCase();
        const usernameRaw = String(body.username || '').trim().toLowerCase();
        const phone = String(body.phone || '').trim();
        const bio = String(body.bio || '').trim();

        if (name.length < 2 || name.length > 80) {
            return res.status(400).json({ detail: 'Display name must be between 2 and 80 characters.' });
        }
        if (!EMAIL_REGEX.test(email) || email.length > 120) {
            return res.status(400).json({ detail: 'Please enter a valid email address.' });
        }
        if (usernameRaw && !USERNAME_REGEX.test(usernameRaw)) {
            return res.status(400).json({ detail: 'Username must be 3–40 characters (letters, numbers, ".", "_", or "-").' });
        }
        if (phone.length > 24) {
            return res.status(400).json({ detail: 'Phone number is too long (max 24 characters).' });
        }
        if (bio.length > 200) {
            return res.status(400).json({ detail: 'Role description / bio must be 200 characters or fewer.' });
        }

        if (req.admin.isSuper) {
            const existingEmail = await SubAdmin.findRowByEmail(email);
            if (existingEmail) {
                return res.status(409).json({ detail: 'This email is already used by a sub-admin account.' });
            }
            if (usernameRaw) {
                const existingUser = await SubAdmin.findRowByUsername(usernameRaw);
                if (existingUser) {
                    return res.status(409).json({ detail: 'This username is already used by a sub-admin account.' });
                }
            }

            const updated = await AdminProfile.updateSuperProfile({
                name,
                email,
                username: usernameRaw,
                phone,
                bio
            });
            forgetSuperAdmin();

            const superMeta = await AdminProfile.getSuperAdmin({ withAuthMeta: true }).catch(() => null);
            const token = issueAdminCookie(res, {
                isAdmin: true,
                email: updated.email,
                role: 'Super Admin',
                loginTime: req.admin.loginTime || new Date().toISOString(),
                sv: superMeta?.password_changed_at || null
            });

            return res.json({
                detail: 'Profile updated successfully.',
                token,
                admin: formatAdminResponse({ ...updated, isSuper: true, loginTime: req.admin.loginTime })
            });
        }

        // Sub-admin editing their own profile
        const superAcc = await AdminProfile.getSuperAdmin();
        if (superAcc) {
            if (email === superAcc.email.toLowerCase() || (superAcc.username && email === superAcc.username.toLowerCase())) {
                return res.status(409).json({ detail: 'This email belongs to the Super Admin account.' });
            }
            if (usernameRaw && (usernameRaw === superAcc.email.toLowerCase() || (superAcc.username && usernameRaw === superAcc.username.toLowerCase()))) {
                return res.status(409).json({ detail: 'This username belongs to the Super Admin account.' });
            }
        }

        const otherByEmail = await SubAdmin.findRowByEmail(email);
        if (otherByEmail && String(otherByEmail.id) !== String(req.admin.id)) {
            return res.status(409).json({ detail: 'Another admin account already uses this email.' });
        }
        if (usernameRaw) {
            const otherByUser = await SubAdmin.findRowByUsername(usernameRaw);
            if (otherByUser && String(otherByUser.id) !== String(req.admin.id)) {
                return res.status(409).json({ detail: 'Another admin account already uses this username.' });
            }
        }

        const updated = await SubAdmin.update(req.admin.id, {
            name,
            email,
            username: usernameRaw,
            phone,
            bio
        });
        forgetSubAdmin(req.admin.id);

        const subAuth = await SubAdmin.findAuthById(updated.id).catch(() => null);
        const token = issueAdminCookie(res, {
            isAdmin: true,
            subAdminId: updated.id,
            email: updated.email,
            role: 'Sub Admin',
            loginTime: req.admin.loginTime || new Date().toISOString(),
            sv: subAuth?.password_changed_at || null
        });

        return res.json({
            detail: 'Profile updated successfully.',
            token,
            admin: formatAdminResponse({ ...updated, isSuper: false, loginTime: req.admin.loginTime })
        });
    } catch (err) {
        if (err?.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ detail: 'Email or username is already in use.' });
        }
        console.error('❌ Admin profile update error:', err);
        return res.status(500).json({ detail: 'Could not update profile details.' });
    }
});

// Change Current Admin Password
router.put('/profile/password', adminAuthMiddleware, async (req, res) => {
    try {
        const currentPassword = String(req.body?.currentPassword || '');
        const newPassword = String(req.body?.newPassword || '');
        const confirmPassword = req.body?.confirmPassword !== undefined ? String(req.body.confirmPassword) : undefined;

        if (!currentPassword) {
            return res.status(400).json({ detail: 'Please enter your current password.' });
        }
        if (newPassword.length < 8 || newPassword.length > 100 || !/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
            return res.status(400).json({ detail: 'New password must be 8–100 characters and include letters and numbers.' });
        }
        if (confirmPassword !== undefined && confirmPassword !== newPassword) {
            return res.status(400).json({ detail: 'New password and confirmation do not match.' });
        }
        if (newPassword === currentPassword) {
            return res.status(400).json({ detail: 'New password must be different from your current password.' });
        }

        if (req.admin.isSuper) {
            const valid = await AdminProfile.verifySuperPassword(currentPassword);
            if (!valid) {
                return res.status(400).json({ detail: 'Current password is incorrect.' });
            }
            const updatedSuper = await AdminProfile.changeSuperPassword(newPassword);
            forgetSuperAdmin();
            const token = issueAdminCookie(res, {
                isAdmin: true,
                email: updatedSuper.email,
                role: 'Super Admin',
                loginTime: req.admin.loginTime || new Date().toISOString(),
                sv: updatedSuper.password_changed_at || null
            });
            return res.json({
                detail: 'Password changed successfully.',
                token,
                admin: formatAdminResponse({ ...updatedSuper, isSuper: true, loginTime: req.admin.loginTime })
            });
        }

        const valid = await SubAdmin.verifyPassword(req.admin.id, currentPassword);
        if (!valid) {
            return res.status(400).json({ detail: 'Current password is incorrect.' });
        }
        const updatedSub = await SubAdmin.update(req.admin.id, { password: newPassword });
        forgetSubAdmin(req.admin.id);
        const subAuth = await SubAdmin.findAuthById(req.admin.id).catch(() => null);
        const token = issueAdminCookie(res, {
            isAdmin: true,
            subAdminId: updatedSub.id,
            email: updatedSub.email,
            role: 'Sub Admin',
            loginTime: req.admin.loginTime || new Date().toISOString(),
            sv: subAuth?.password_changed_at || null
        });
        return res.json({
            detail: 'Password changed successfully.',
            token,
            admin: formatAdminResponse({ ...updatedSub, isSuper: false, loginTime: req.admin.loginTime })
        });
    } catch (err) {
        console.error('❌ Admin password change error:', err);
        return res.status(500).json({ detail: 'Could not change password.' });
    }
});

// ---------- Sub-admins: made and managed by the super admin only ----------
const SUB_ADMIN_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const subAdminInput = (body, { creating }, superAcc = null) => {
    const out = {};
    if (creating || body.name !== undefined) {
        const name = String(body.name || '').trim();
        if (name.length < 2 || name.length > 80) return { error: 'Please enter a name (2 to 80 letters).' };
        out.name = name;
    }
    if (creating) {
        const email = String(body.email || '').trim().toLowerCase();
        if (!SUB_ADMIN_EMAIL.test(email) || email.length > 120) return { error: 'Please enter a valid email address.' };
        const superEmail = (superAcc?.email || ADMIN_EMAIL).toLowerCase();
        const superUsername = (superAcc?.username || 'admin').toLowerCase();
        if (email === superEmail || (superUsername && email === superUsername)) {
            return { error: 'That is the super admin email.' };
        }
        out.email = email;
    }
    if (creating || (body.password !== undefined && body.password !== '')) {
        const password = String(body.password || '');
        if (password.length < 8 || password.length > 100 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
            return { error: 'The password needs at least 8 characters, with letters and numbers.' };
        }
        out.password = password;
    }
    if (body.permissions !== undefined) {
        if (!Array.isArray(body.permissions)) return { error: 'Choose the pages this admin may open.' };
        out.permissions = body.permissions;
    } else if (creating) {
        out.permissions = [];
    }
    if (body.active !== undefined) out.active = Boolean(body.active);
    return { value: out };
};

router.get('/sub-admins', adminAuthMiddleware, superAdminOnly, async (req, res) => {
    try {
        return res.json({ subAdmins: await SubAdmin.list(), pages: ADMIN_PAGES });
    } catch (err) {
        console.error('❌ Sub-admin list error:', err);
        return res.status(500).json({ detail: 'Could not load the sub-admins.' });
    }
});

router.post('/sub-admins', adminAuthMiddleware, superAdminOnly, async (req, res) => {
    try {
        const superAcc = await AdminProfile.getSuperAdmin();
        const input = subAdminInput(req.body || {}, { creating: true }, superAcc);
        if (input.error) return res.status(400).json({ detail: input.error });
        if (await SubAdmin.findRowByEmail(input.value.email)) {
            return res.status(409).json({ detail: 'A sub-admin with this email already exists.' });
        }
        const created = await SubAdmin.create({ ...input.value, createdBy: req.admin.email });
        return res.status(201).json({ subAdmin: created });
    } catch (err) {
        if (err?.code === 'ER_DUP_ENTRY') return res.status(409).json({ detail: 'A sub-admin with this email already exists.' });
        console.error('❌ Sub-admin create error:', err);
        return res.status(500).json({ detail: 'Could not create the sub-admin.' });
    }
});

router.put('/sub-admins/:id', adminAuthMiddleware, superAdminOnly, async (req, res) => {
    try {
        if (!(await SubAdmin.findById(req.params.id))) return res.status(404).json({ detail: 'Sub-admin not found.' });
        const input = subAdminInput(req.body || {}, { creating: false });
        if (input.error) return res.status(400).json({ detail: input.error });
        const updated = await SubAdmin.update(req.params.id, input.value);
        forgetSubAdmin(req.params.id);
        return res.json({ subAdmin: updated });
    } catch (err) {
        console.error('❌ Sub-admin update error:', err);
        return res.status(500).json({ detail: 'Could not update the sub-admin.' });
    }
});

router.delete('/sub-admins/:id', adminAuthMiddleware, superAdminOnly, async (req, res) => {
    try {
        if (!(await SubAdmin.findById(req.params.id))) return res.status(404).json({ detail: 'Sub-admin not found.' });
        await SubAdmin.remove(req.params.id);
        forgetSubAdmin(req.params.id);
        return res.json({ detail: 'Sub-admin removed.' });
    } catch (err) {
        console.error('❌ Sub-admin delete error:', err);
        return res.status(500).json({ detail: 'Could not remove the sub-admin.' });
    }
});

// Admin Logout
router.post('/logout', (req, res) => {
    res.clearCookie('slipzo_admin_token', getAdminCookieOptions());
    return res.json({ detail: 'Admin logged out successfully' });
});

// System Analytics & Stats
router.get('/stats', adminAuthMiddleware, adminCan('overview'), async (req, res) => {
    try {
        const usersCount = await queryOne('SELECT COUNT(*) as count FROM users');
        const shopsCount = await queryOne('SELECT COUNT(*) as count FROM shops');
        const billsCount = await queryOne('SELECT COUNT(*) as count FROM bills');
        const productsCount = await queryOne('SELECT COUNT(*) as count FROM products');
        const customersCount = await queryOne('SELECT COUNT(*) as count FROM customers');

        // Recent 5 users
        const recentUsers = await query(`
            SELECT u.id, u.name, u.email, u.created_at, s.name as shop_name 
            FROM users u 
            LEFT JOIN shops s ON s.user_id = u.id 
            ORDER BY u.created_at DESC 
            LIMIT 5
        `);

        return res.json({
            stats: {
                totalUsers: parseInt(usersCount?.count || 0),
                totalShops: parseInt(shopsCount?.count || 0),
                totalBills: parseInt(billsCount?.count || 0),
                totalProducts: parseInt(productsCount?.count || 0),
                totalCustomers: parseInt(customersCount?.count || 0)
            },
            recentUsers,
            systemHealth: {
                status: 'healthy',
                uptime: process.uptime(),
                nodeVersion: process.version,
                platform: process.platform,
                timestamp: new Date().toISOString()
            }
        });
    } catch (err) {
        console.error('❌ Error fetching admin stats:', err);
        return res.status(500).json({ detail: 'Failed to fetch admin stats' });
    }
});

// Platform analytics for the overview page: growth, usage and plan revenue over a chosen period.
// Days are counted in Indian time. Admin print grants (amount 0) never count as revenue.
router.get('/analytics', adminAuthMiddleware, adminCan('overview'), async (req, res) => {
    try {
        const days = [7, 30, 90, 365].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
        const monthly = days > 90;
        const pg = isPostgres();
        const dayOf = (col) => pg
            ? `to_char((${col} AT TIME ZONE 'Asia/Kolkata'), '${monthly ? 'YYYY-MM' : 'YYYY-MM-DD'}')`
            : `strftime('${monthly ? '%Y-%m' : '%Y-%m-%d'}', ${col}, '+330 minutes')`;
        const istDate = (d) => new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 10);
        const now = new Date();
        const start = new Date(now.getTime() - (days - 1) * 86400000);
        const prevStart = new Date(start.getTime() - days * 86400000);
        // compared as text on SQLite ('YYYY-MM-DD ...'), as a timestamp on Postgres; a day early keeps the time-zone edge inside, the buckets trim it
        const since = istDate(new Date(prevStart.getTime() - 86400000));
        const paid = `(payment_status = 'completed' OR payment_status IS NULL) AND amount > 0`;
        const safe = (p) => p.catch((err) => { console.error('analytics query failed:', err.message); return []; });

        const [userRows, billRows, revRows, prevBillRow, prevUserRow, prevRevRow, totals, planRows, modeRows, topRows, activeRow, prevActiveRow, funnelShops, funnelBillers, funnelPayers, grantRow] = await Promise.all([
            safe(query(`SELECT ${dayOf('created_at')} AS d, COUNT(*) AS n FROM users WHERE created_at >= ? GROUP BY d`, [since])),
            safe(query(`SELECT ${dayOf('created_at')} AS d, COUNT(*) AS n, COALESCE(SUM(total), 0) AS amt FROM bills WHERE created_at >= ? GROUP BY d`, [since])),
            safe(query(`SELECT ${dayOf('created_at')} AS d, COUNT(*) AS n, COALESCE(SUM(amount), 0) AS amt FROM subscriptions WHERE ${paid} AND created_at >= ? GROUP BY d`, [since])),
            safe(queryOne(`SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS amt FROM bills WHERE created_at >= ? AND created_at < ?`, [istDate(prevStart), istDate(start)]).then((r) => [r])),
            safe(queryOne(`SELECT COUNT(*) AS n FROM users WHERE created_at >= ? AND created_at < ?`, [istDate(prevStart), istDate(start)]).then((r) => [r])),
            safe(queryOne(`SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS amt FROM subscriptions WHERE ${paid} AND created_at >= ? AND created_at < ?`, [istDate(prevStart), istDate(start)]).then((r) => [r])),
            safe(queryOne(`SELECT COALESCE(SUM(amount), 0) AS revenue, COUNT(*) AS purchases, COUNT(DISTINCT user_id) AS payers FROM subscriptions WHERE ${paid}`).then((r) => [r])),
            safe(query(`SELECT COALESCE(plan_name, 'Plan') AS name, COUNT(*) AS n, COALESCE(SUM(amount), 0) AS amt FROM subscriptions WHERE ${paid} AND created_at >= ? GROUP BY COALESCE(plan_name, 'Plan') ORDER BY amt DESC`, [istDate(start)])),
            safe(query(`SELECT COALESCE(payment_mode, 'Cash') AS name, COUNT(*) AS n, COALESCE(SUM(total), 0) AS amt FROM bills WHERE created_at >= ? GROUP BY COALESCE(payment_mode, 'Cash') ORDER BY n DESC`, [istDate(start)])),
            safe(query(`SELECT b.user_id, MAX(COALESCE(s.name, b.shop_name)) AS name, COUNT(*) AS n, COALESCE(SUM(b.total), 0) AS amt FROM bills b LEFT JOIN shops s ON s.user_id = b.user_id WHERE b.created_at >= ? GROUP BY b.user_id ORDER BY n DESC LIMIT 6`, [istDate(start)])),
            safe(queryOne(`SELECT COUNT(DISTINCT user_id) AS n FROM bills WHERE created_at >= ?`, [istDate(start)]).then((r) => [r])),
            safe(queryOne(`SELECT COUNT(DISTINCT user_id) AS n FROM bills WHERE created_at >= ? AND created_at < ?`, [istDate(prevStart), istDate(start)]).then((r) => [r])),
            safe(queryOne(`SELECT COUNT(DISTINCT user_id) AS n FROM shops`).then((r) => [r])),
            safe(queryOne(`SELECT COUNT(DISTINCT user_id) AS n FROM bills`).then((r) => [r])),
            safe(queryOne(`SELECT COUNT(DISTINCT user_id) AS n FROM subscriptions WHERE ${paid}`).then((r) => [r])),
            safe(queryOne(`SELECT COUNT(*) AS n, COALESCE(SUM(prints_count), 0) AS prints FROM subscriptions WHERE amount = 0 AND created_at >= ?`, [istDate(start)]).then((r) => [r]))
        ]);
        const num = (v) => Number(v || 0);
        const one = (rows) => (rows && rows[0]) || {};
        const usersTotal = num(one(await safe(queryOne('SELECT COUNT(*) AS n FROM users').then((r) => [r]))).n);

        // one bucket per day (or month), oldest first, with zeros where nothing happened
        const keys = [];
        if (monthly) {
            const d = new Date(istDate(now) + 'T00:00:00Z');
            for (let i = 11; i >= 0; i--) keys.push(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
        } else {
            for (let i = 0; i < days; i++) keys.push(istDate(new Date(start.getTime() + i * 86400000)));
        }
        const map = (rows) => Object.fromEntries((rows || []).map((r) => [String(r.d), r]));
        const u = map(userRows), b = map(billRows), r = map(revRows);
        const series = keys.map((k) => ({
            date: k,
            newUsers: num(u[k]?.n),
            bills: num(b[k]?.n),
            billValue: Math.round(num(b[k]?.amt)),
            revenue: Math.round(num(r[k]?.amt)),
            purchases: num(r[k]?.n)
        }));
        const sum = (f) => series.reduce((a, x) => a + x[f], 0);
        const prevBill = one(prevBillRow), prevRev = one(prevRevRow), tot = one(totals);

        return res.json({
            days,
            bucket: monthly ? 'month' : 'day',
            series,
            current: {
                revenue: sum('revenue'), purchases: sum('purchases'), newUsers: sum('newUsers'),
                bills: sum('bills'), billValue: sum('billValue'), activeShops: num(one(activeRow).n)
            },
            previous: {
                revenue: Math.round(num(prevRev.amt)), purchases: num(prevRev.n), newUsers: num(one(prevUserRow).n),
                bills: num(prevBill.n), billValue: Math.round(num(prevBill.amt)), activeShops: num(one(prevActiveRow).n)
            },
            lifetime: {
                revenue: Math.round(num(tot.revenue)), purchases: num(tot.purchases), payers: num(tot.payers), users: usersTotal
            },
            funnel: {
                registered: usersTotal,
                shopSetup: num(one(funnelShops).n),
                madeBill: num(one(funnelBillers).n),
                paid: num(one(funnelPayers).n)
            },
            plans: (planRows || []).map((x) => ({ name: x.name, count: num(x.n), revenue: Math.round(num(x.amt)) })),
            paymentModes: (modeRows || []).map((x) => ({ name: x.name, count: num(x.n), amount: Math.round(num(x.amt)) })),
            topShops: (topRows || []).map((x) => ({ id: x.user_id, name: x.name || 'Shop', bills: num(x.n), amount: Math.round(num(x.amt)) })),
            grants: { count: num(one(grantRow).n), prints: num(one(grantRow).prints) }
        });
    } catch (err) {
        console.error('❌ Error building admin analytics:', err);
        return res.status(500).json({ detail: 'Failed to load analytics' });
    }
});

// ---------- Error Monitor: errors from the web app, the Android app and the server, one row per distinct error ----------
router.get('/errors', adminAuthMiddleware, adminCan('errors'), async (req, res, next) => {
    try {
        const { status = 'open', source = 'all', search = '', sort = 'recent' } = req.query;
        const [errors, summary] = await Promise.all([ErrorLog.list({ status, source, search, sort }), ErrorLog.summary()]);
        res.json({ errors, summary });
    } catch (err) { next(err); }
});

router.put('/errors/:id', adminAuthMiddleware, adminCan('errors'), async (req, res, next) => {
    try {
        const status = req.body?.status;
        if (!['open', 'resolved'].includes(status)) return res.status(400).json({ detail: 'Status must be open or resolved.' });
        if (!(await ErrorLog.setStatus(req.params.id, status))) return res.status(404).json({ detail: 'Error not found.' });
        res.json({ success: true });
    } catch (err) { next(err); }
});

router.delete('/errors/resolved', adminAuthMiddleware, adminCan('errors'), async (req, res, next) => {
    try {
        res.json({ success: true, removed: await ErrorLog.removeResolved() });
    } catch (err) { next(err); }
});

router.delete('/errors/:id', adminAuthMiddleware, adminCan('errors'), async (req, res, next) => {
    try {
        if (!(await ErrorLog.remove(req.params.id))) return res.status(404).json({ detail: 'Error not found.' });
        res.json({ success: true });
    } catch (err) { next(err); }
});

// User & Shop List
router.get('/users', adminAuthMiddleware, adminCan('users'), async (req, res) => {
    try {
        const search = req.query.search ? `%${req.query.search.trim()}%` : null;

        let sql = `
            SELECT 
                u.id, 
                u.name, 
                u.email, 
                u.username, 
                u.created_at,
                s.name as shop_name, 
                s.phone as shop_phone, 
                s.address as shop_address,
                s.logo_url as shop_profile,
                s.logo_url as shop_logo_url,
                s.invoice_prefix,
                s.gstin as shop_gstin,
                (SELECT COUNT(*) FROM bills WHERE user_id = u.id) as bill_count,
                (SELECT COUNT(*) FROM products WHERE user_id = u.id) as product_count
            FROM users u
            LEFT JOIN shops s ON s.user_id = u.id
        `;

        const params = [];
        if (search) {
            sql += ` WHERE u.name LIKE ? OR u.email LIKE ? OR s.name LIKE ? OR s.phone LIKE ?`;
            params.push(search, search, search, search);
        }

        sql += ` ORDER BY u.created_at DESC`;

        const users = await query(sql, params);
        const list = users || [];
        await Promise.all(list.map(async (u) => {
            const quota = await Subscription.getQuotaByUserId(u.id).catch(() => null);
            u.prints_total = quota ? quota.totalPrints : 0;
            u.prints_used = quota ? quota.usedPrints : 0;
            u.prints_remaining = quota ? quota.printsRemaining : 0;
            u.plan_name = quota ? quota.activePlanName : null;
        }));
        return res.json({ users: list });
    } catch (err) {
        console.error('❌ Error fetching users for admin:', err);
        return res.status(500).json({ detail: 'Failed to fetch users' });
    }
});

// System Bills Log
router.get('/bills', adminAuthMiddleware, adminCan('bills'), async (req, res) => {
    try {
        const sql = `
            SELECT 
                b.id,
                b.number as bill_number,
                b.customer_name,
                b.total,
                b.created_at,
                u.name as user_name,
                u.email as user_email,
                s.name as shop_name
            FROM bills b
            LEFT JOIN users u ON u.id = b.user_id
            LEFT JOIN shops s ON s.user_id = b.user_id
            ORDER BY b.created_at DESC
            LIMIT 50
        `;
        const bills = await query(sql);
        return res.json({ bills: bills || [] });
    } catch (err) {
        console.error('❌ Error fetching system bills for admin:', err);
        return res.status(500).json({ detail: 'Failed to fetch system bills' });
    }
});

// Support Contact Submissions Log
router.get('/contacts', adminAuthMiddleware, adminCan('contacts'), async (req, res) => {
    try {
        const submissions = await ContactSubmission.findAll();
        return res.json({ contacts: submissions || [] });
    } catch (err) {
        console.error('❌ Error fetching contact submissions for admin:', err);
        return res.status(500).json({ detail: 'Failed to fetch contact submissions' });
    }
});

// System Templates Management
router.get('/templates', adminAuthMiddleware, adminCan('templates'), async (req, res) => {
    try {
        const sql = `
            SELECT 
                t.id, 
                t.name, 
                t.category, 
                t.width, 
                t.created_at,
                u.name as user_name, 
                u.email as user_email, 
                s.name as shop_name
            FROM templates t
            LEFT JOIN users u ON u.id = t.user_id
            LEFT JOIN shops s ON s.user_id = t.user_id
            ORDER BY t.created_at DESC
        `;
        const templates = await query(sql);
        return res.json({ templates: templates || [] });
    } catch (err) {
        console.error('❌ Error fetching templates for admin:', err);
        return res.status(500).json({ detail: 'Failed to fetch system templates' });
    }
});

// Create New Admin Template
router.post('/templates', adminAuthMiddleware, adminCan('templates'), async (req, res) => {
    try {
        const { name, category, width } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ detail: 'Template name is required' });
        }

        const { v4: uuidv4 } = await import('uuid');
        const id = uuidv4();
        const now = new Date().toISOString();

        // Get a valid user_id or use default
        const adminUser = await queryOne('SELECT id FROM users LIMIT 1');
        const userId = adminUser?.id || 'system-admin';

        await query(
            `INSERT INTO templates (id, user_id, name, category, width, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [id, userId, name.trim(), category ? category.trim() : 'Business', width ? width.trim() : '58mm', now, now]
        );

        return res.status(201).json({ detail: 'Template created successfully', id });
    } catch (err) {
        console.error('❌ Error creating admin template:', err);
        return res.status(500).json({ detail: 'Failed to create template' });
    }
});

// Update Admin Template
router.put('/templates/:id', adminAuthMiddleware, adminCan('templates'), async (req, res) => {
    try {
        const { id } = req.params;
        const { name, category, width } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ detail: 'Template name is required' });
        }

        const now = new Date().toISOString();
        await query(
            `UPDATE templates SET name = ?, category = ?, width = ?, updated_at = ? WHERE id = ?`,
            [name.trim(), category ? category.trim() : 'Business', width ? width.trim() : '58mm', now, id]
        );

        return res.json({ detail: 'Template updated successfully' });
    } catch (err) {
        console.error('❌ Error updating admin template:', err);
        return res.status(500).json({ detail: 'Failed to update template' });
    }
});

// Delete Admin Template
router.delete('/templates/:id', adminAuthMiddleware, adminCan('templates'), async (req, res) => {
    try {
        const { id } = req.params;
        await query(`DELETE FROM templates WHERE id = ?`, [id]);
        return res.json({ detail: 'Template deleted successfully' });
    } catch (err) {
        console.error('❌ Error deleting admin template:', err);
        return res.status(500).json({ detail: 'Failed to delete template' });
    }
});

// System Product Catalog Management
router.get('/products', adminAuthMiddleware, adminCan('products'), async (req, res) => {
    try {
        const sql = `
            SELECT 
                p.id, 
                p.name, 
                p.price, 
                p.category, 
                p.product_link,
                p.description,
                p.tax_rate, 
                p.stock as stock_quantity, 
                p.image,
                p.images,
                p.status,
                p.created_at,
                u.name as user_name, 
                u.email as user_email, 
                s.name as shop_name
            FROM products p
            LEFT JOIN users u ON u.id = p.user_id
            LEFT JOIN shops s ON s.user_id = p.user_id
            ORDER BY p.created_at DESC
        `;
        const products = await query(sql);
        const normalized = (products || []).map(p => ({
            ...p,
            status: (p.status || 'active').toLowerCase().trim()
        }));
        return res.json({ products: normalized });
    } catch (err) {
        console.error('❌ Error fetching products for admin:', err);
        return res.status(500).json({ detail: 'Failed to fetch products' });
    }
});

// Create New Admin Product with Photos
router.post('/products', adminAuthMiddleware, adminCan('products'), async (req, res) => {
    try {
        const { name, category, price, product_link, description, images, image, status } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ detail: 'Product name is required' });
        }

        if (!product_link || !product_link.trim()) {
            return res.status(400).json({ detail: 'Product link is required' });
        }

        const cleanLink = product_link.trim();
        try {
            const parsedUrl = new URL(cleanLink);
            if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
                return res.status(400).json({ detail: 'Please enter a valid HTTP or HTTPS product link URL' });
            }
        } catch (_) {
            return res.status(400).json({ detail: 'Please enter a valid URL for the product link' });
        }

        const cleanName = name.trim();
        const existingProd = await queryOne(`SELECT id, name FROM products WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))`, [cleanName]);
        if (existingProd) {
            return res.status(400).json({ detail: `A product with name "${cleanName}" already exists.` });
        }

        let photoList = [];
        if (Array.isArray(images)) {
            photoList = images;
        } else if (typeof images === 'string' && images.trim()) {
            try { photoList = JSON.parse(images); } catch (_) { photoList = [images]; }
        } else if (image) {
            photoList = [image];
        }

        if (photoList.length < 1) {
            return res.status(400).json({ detail: 'Please upload at least 1 product photo.' });
        }
        if (photoList.length > 5) {
            return res.status(400).json({ detail: 'You can upload a maximum of 5 product photos.' });
        }

        const { v4: uuidv4 } = await import('uuid');
        const id = uuidv4();
        const now = new Date().toISOString();

        const adminUser = await queryOne('SELECT id FROM users ORDER BY created_at ASC LIMIT 1');
        if (!adminUser || !adminUser.id) {
            return res.status(400).json({ detail: 'No system user found to associate product.' });
        }
        const userId = adminUser.id;

        // Process base64 photos and upload directly to Supabase Storage (blocking SVG/unsafe URLs)
        const processedPhotoUrls = [];
        for (let idx = 0; idx < photoList.length; idx++) {
            const rawImg = photoList[idx];
            if (typeof rawImg === 'string' && rawImg.trim()) {
                const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'product';
                const uploadedUrl = await processUploadImage(rawImg, {
                    bucket: 'menu-item-images',
                    allowRelative: true,
                    objectPathBuilder: (ext) => `products/${slug}-${Date.now()}-${idx}.${ext}`
                });
                if (uploadedUrl) processedPhotoUrls.push(uploadedUrl);
            }
        }

        const mainImage = processedPhotoUrls[0] || image || '';
        const imagesJson = JSON.stringify(processedPhotoUrls);
        const prodStatus = (status || 'active').toLowerCase().trim();
        const catLower = (category || '').toLowerCase().trim();

        // Route to category-specific database table
        try {
            if (catLower.includes('kirana') || catLower.includes('grocery')) {
                const barcode = `SLP-${Math.floor(100000 + Math.random() * 900000)}`;
                await query(
                    `INSERT INTO menu_items (id, barcode, name, category, price, image_url, description, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [id, barcode, name.trim(), category.trim(), parseFloat(price) || 0, mainImage, name.trim(), now, now]
                );
                try {
                    await query(
                        `INSERT INTO kirana_store (id, original_product_id, barcode, name, category, shop_category, price, image_url, description, status, created_at, updated_at)
                         VALUES (?, ?, ?, ?, ?, 'Kirana', ?, ?, ?, 'active', ?, ?)`,
                        [id, id, barcode, name.trim(), category.trim(), parseFloat(price) || 0, mainImage, name.trim(), now, now]
                    );
                } catch (kErr) {
                    console.warn('⚠️ kirana_store insert error:', kErr.message);
                }
            } else if (catLower.includes('hotel') || catLower.includes('restaurant')) {
                await query(
                    `INSERT INTO hotel_food (id, name, category, price, image_url, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [id, name.trim(), category.trim(), parseFloat(price) || 0, mainImage, now, now]
                );
            } else if (catLower.includes('clothing') || catLower.includes('garment')) {
                const barcode = `CLO-${Math.floor(100000 + Math.random() * 900000)}`;
                await query(
                    `INSERT INTO clothing_garments (id, barcode, name, category, price, image_url, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [id, barcode, name.trim(), category.trim(), parseFloat(price) || 0, mainImage, now, now]
                );
            } else if (catLower.includes('small') || catLower.includes('business') || catLower.includes('cafe')) {
                await query(
                    `INSERT INTO small_business (id, name, category, price, image_url, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [id, name.trim(), category.trim(), parseFloat(price) || 0, mainImage, now, now]
                );
            }
        } catch (catErr) {
            console.warn('⚠️ Category table insert notice:', catErr.message);
        }

        // Master products database table insert
        await query(
            `INSERT INTO products (id, user_id, name, price, category, product_link, description, stock, image, images, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                id,
                userId,
                name.trim(),
                parseFloat(price) || 0,
                category ? category.trim() : 'General',
                cleanLink,
                description ? description.trim() : '',
                100,
                mainImage,
                imagesJson,
                prodStatus,
                now,
                now
            ]
        );

        const newProd = await queryOne(`SELECT * FROM products WHERE id = ?`, [id]);
        return res.status(201).json({ detail: 'Product created successfully', product: newProd });
    } catch (err) {
        if (err?.statusCode) {
            return res.status(err.statusCode).json({ detail: err.message });
        }
        console.error('❌ Error creating admin product:', err);
        return res.status(500).json({ detail: 'Failed to create product' });
    }
});

// Update Admin Product (General or Status)
router.put('/products/:id', adminAuthMiddleware, adminCan('products'), async (req, res) => {
    try {
        const { id } = req.params;
        const { status, name, price, category, product_link, description, tax_rate, stock, image } = req.body;

        let existing = await queryOne(`SELECT * FROM products WHERE id = ?`, [id]);
        if (!existing && name) {
            existing = await queryOne(`SELECT * FROM products WHERE LOWER(name) = ?`, [name.trim().toLowerCase()]);
        }
        if (!existing) {
            return res.status(404).json({ detail: 'Product not found' });
        }

        const targetId = existing.id;
        const newStatus = status ? status.toLowerCase().trim() : (existing.status || 'active');
        const newName = name !== undefined ? name.trim() : existing.name;
        const newPrice = price !== undefined ? parseFloat(price) : existing.price;
        const newCat = category !== undefined ? category.trim() : existing.category;
        const newLink = product_link !== undefined ? sanitizeAssetUrl(product_link) : (existing.product_link || '');
        const newDesc = description !== undefined ? (description ? description.trim() : '') : (existing.description || '');
        const slug = (newName || 'product').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'product';
        const newImage = image !== undefined
            ? (image ? await processUploadImage(image, { bucket: 'menu-item-images', allowRelative: true, objectPathBuilder: (ext) => `products/${slug}-${Date.now()}.${ext}` }) : '')
            : (existing.image || '');
        const newStock = stock !== undefined ? parseInt(stock) : existing.stock;
        const now = new Date().toISOString();

        await query(
            `UPDATE products SET name = ?, price = ?, category = ?, product_link = ?, description = ?, stock = ?, image = ?, status = ?, updated_at = ? WHERE id = ?`,
            [newName, newPrice, newCat, newLink, newDesc, newStock, newImage, newStatus, now, targetId]
        );

        const updated = await queryOne(`SELECT * FROM products WHERE id = ?`, [targetId]);
        return res.json({ detail: 'Product updated successfully', product: updated });
    } catch (err) {
        if (err?.statusCode) {
            return res.status(err.statusCode).json({ detail: err.message });
        }
        console.error('❌ Error updating admin product:', err);
        return res.status(500).json({ detail: 'Failed to update product' });
    }
});

// Update Admin Product Status (Active / Inactive)
router.put('/products/:id/status', adminAuthMiddleware, adminCan('products'), async (req, res) => {
    try {
        const { id } = req.params;
        const { status, name } = req.body;
        if (!status || !['active', 'inactive'].includes(status.toLowerCase().trim())) {
            return res.status(400).json({ detail: 'Invalid status. Must be "active" or "inactive".' });
        }
        const newStatus = status.toLowerCase().trim();
        const now = new Date().toISOString();

        let existing = await queryOne(`SELECT * FROM products WHERE id = ?`, [id]);
        if (!existing && name) {
            existing = await queryOne(`SELECT * FROM products WHERE LOWER(name) = ?`, [name.trim().toLowerCase()]);
        }
        if (!existing) {
            return res.status(404).json({ detail: 'Product not found' });
        }

        const targetId = existing.id;
        await query(`UPDATE products SET status = ?, updated_at = ? WHERE id = ?`, [newStatus, now, targetId]);
        const updated = await queryOne(`SELECT * FROM products WHERE id = ?`, [targetId]);
        return res.json({ detail: 'Product status updated successfully', product: updated });
    } catch (err) {
        console.error('❌ Error updating admin product status:', err);
        return res.status(500).json({ detail: 'Failed to update product status' });
    }
});

// Delete Admin Product
router.delete('/products/:id', adminAuthMiddleware, adminCan('products'), async (req, res) => {
    try {
        const { id } = req.params;
        await query(`DELETE FROM products WHERE id = ?`, [id]);
        return res.json({ detail: 'Product deleted successfully' });
    } catch (err) {
        console.error('❌ Error deleting admin product:', err);
        return res.status(500).json({ detail: 'Failed to delete product' });
    }
});

// Plan Buyer Users & Active Subscriptions
router.get('/plan-buyers', adminAuthMiddleware, adminCan('plan_buyers'), async (req, res) => {
    try {
        const subSql = `
            SELECT 
                sub.id as subscription_id,
                sub.user_id,
                COALESCE(u.name, sub.user_name, 'Paid Customer') as user_name,
                COALESCE(u.email, sub.user_email) as user_email,
                sub.plan_name,
                sub.amount,
                sub.prints_count,
                sub.payment_id,
                sub.payment_status,
                sub.created_at,
                s.name as shop_name,
                s.phone as shop_phone,
                (SELECT COUNT(*) FROM bills WHERE user_id = sub.user_id) as total_bills_printed
            FROM subscriptions sub
            LEFT JOIN users u ON u.id = sub.user_id
            LEFT JOIN shops s ON s.user_id = sub.user_id
            ORDER BY sub.created_at DESC
        `;
        const buyers = await query(subSql).catch(() => []);
        return res.json({ planBuyers: buyers || [] });
    } catch (err) {
        console.error('❌ Error fetching plan buyers for admin:', err);
        return res.status(500).json({ detail: 'Failed to fetch plan buyers' });
    }
});

// Plans Management (Create & Edit all Time-based and Print-based plans)
// ---------- Push notifications to the app (announcements, discount offers, plan reminders) ----------
router.get('/push/status', adminAuthMiddleware, adminCan('notifications'), async (req, res, next) => {
    try {
        res.json({ configured: isPushConfigured(), ...(await Push.deviceCount()) });
    } catch (err) { next(err); }
});

router.get('/push/messages', adminAuthMiddleware, adminCan('notifications'), async (req, res, next) => {
    try {
        res.json(await Push.listMessages(Number(req.query.limit) || 50));
    } catch (err) { next(err); }
});

router.post('/push/send', adminAuthMiddleware, adminCan('notifications'), async (req, res, next) => {
    try {
        const title = String(req.body?.title || '').trim();
        const body = String(req.body?.body || '').trim();
        const kind = ['announcement', 'discount', 'plan_reminder'].includes(req.body?.kind) ? req.body.kind : 'announcement';
        const code = String(req.body?.code || '').trim().toUpperCase().slice(0, 30);
        if (title.length < 3 || title.length > 100) return res.status(400).json({ detail: 'Title must be 3 to 100 characters' });
        if (body.length < 3 || body.length > 500) return res.status(400).json({ detail: 'Message must be 3 to 500 characters' });
        // always shown in the app's notification bell; also pushed to phones when Firebase is set up

        // target: everyone with the app, or one user found by mobile number
        let target = 'all';
        const phone = String(req.body?.phone || '').trim();
        if (req.body?.target === 'user') {
            const digits = phone.replace(/\D/g, '').slice(-10);
            if (digits.length !== 10) return res.status(400).json({ detail: 'Enter the 10-digit mobile number of the user' });
            const user = await queryOne("SELECT id FROM users WHERE phone = ? OR phone = ? OR phone = ?", [digits, `91${digits}`, `+91${digits}`]);
            if (!user) return res.status(404).json({ detail: 'No user with that mobile number' });
            target = user.id;
        }

        // discounts and plan reminders open the Pricing page when tapped
        const view = kind === 'announcement' ? '' : 'pricing';
        const result = await Push.sendAdminMessage({ title, body, kind, code, view, target, sentBy: req.admin?.email || req.admin?.username || 'admin' });
        res.json(result);
    } catch (err) { next(err); }
});

router.get('/plans', adminAuthMiddleware, adminCan('plans'), getAdminPlans);
router.post('/plans', adminAuthMiddleware, adminCan('plans'), createPlan);
router.put('/plans/:id', adminAuthMiddleware, adminCan('plans'), updatePlan);
router.delete('/plans/:id', adminAuthMiddleware, adminCan('plans'), deletePlan);

// Grant Print Credits to User Shop
router.post('/users/:id/grant-prints', adminAuthMiddleware, adminCan('grant_credits'), async (req, res) => {
    try {
        const { printsToGrant } = req.body;
        const userId = req.params.id;
        const count = parseInt(printsToGrant || 500);

        if (isNaN(count) || count <= 0 || count > 1000000) {
            return res.status(400).json({ detail: 'Invalid print count' });
        }

        const userRows = await query('SELECT id, name, email FROM users WHERE id = ? LIMIT 1', [userId]);
        const user = userRows && userRows[0];
        if (!user) {
            return res.status(404).json({ detail: 'User not found' });
        }

        await Subscription.create({
            user_id: user.id,
            user_name: user.name,
            user_email: user.email,
            plan_name: 'Admin Grant',
            amount: 0,
            prints_count: count,
            payment_id: `ADMIN_GRANT_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            payment_status: 'completed'
        });

        const quota = await Subscription.getQuotaByUserId(user.id);
        return res.json({
            detail: `Granted ${count.toLocaleString('en-IN')} prints. ${user.name || 'The user'} now has ${quota.printsRemaining.toLocaleString('en-IN')} prints left.`,
            granted: count,
            userId: user.id,
            quota
        });
    } catch (err) {
        console.error('❌ Error granting print credits:', err);
        return res.status(500).json({ detail: 'Failed to grant print credits' });
    }
});

// ==========================================
// ADMIN MASTER MENU MANAGEMENT ENDPOINTS
// ==========================================

// Get All Master Menu Items (with search, category, pagination)
router.get('/menu', adminAuthMiddleware, adminCan('menu'), async (req, res) => {
    try {
        const { search = '', category = 'all', page = 1, limit = 50 } = req.query;
        const result = await MenuItem.findAllAdmin({ search, category, page, limit });
        return res.json(result);
    } catch (err) {
        console.error('❌ Error fetching admin menu items:', err);
        return res.status(500).json({ detail: 'Failed to fetch menu items' });
    }
});

// Helper to process base64 image upload to Supabase Storage
async function processMasterItemImage(rawImg, name) {
    const safeName = (name || 'item').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
    return processUploadImage(rawImg, {
        bucket: 'menu-item-images',
        allowRelative: false,
        objectPathBuilder: (ext) => `admin/${safeName}-${Date.now()}.${ext}`
    });
}

// Create New Master Menu Item
router.post('/menu', adminAuthMiddleware, adminCan('menu'), async (req, res) => {
    try {
        const { name, price, category, image_url, description, is_available, barcode, barcode_type } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ detail: 'Item name is required' });
        }

        const numPrice = parseFloat(price);
        if (price === undefined || isNaN(numPrice) || numPrice < 0) {
            return res.status(400).json({ detail: 'Base price must be a non-negative number' });
        }

        const finalImageUrl = await processMasterItemImage(image_url, name);

        const item = await MenuItem.createMaster({
            name: name.trim(),
            price: numPrice,
            category: (category || '').trim() || 'General',
            image_url: finalImageUrl || '',
            description: (description || '').trim(),
            is_available: is_available !== undefined ? Boolean(is_available) : true,
            barcode: barcode ? String(barcode).trim() : undefined,
            barcode_type: barcode_type ? String(barcode_type).trim().toUpperCase() : undefined
        });

        return res.status(201).json({ detail: 'Master menu item created successfully', item });
    } catch (err) {
        console.error('❌ Error creating master menu item:', err);
        return res.status(err.statusCode || 500).json({ detail: err.message || 'Failed to create menu item' });
    }
});

// Update Master Menu Item
router.put('/menu/:id', adminAuthMiddleware, adminCan('menu'), async (req, res) => {
    try {
        const { id } = req.params;
        const { name, price, category, image_url, description, is_available, barcode, barcode_type } = req.body;

        if (name !== undefined && !name.trim()) {
            return res.status(400).json({ detail: 'Item name cannot be empty' });
        }

        if (price !== undefined) {
            const numPrice = parseFloat(price);
            if (isNaN(numPrice) || numPrice < 0) {
                return res.status(400).json({ detail: 'Base price must be a non-negative number' });
            }
        }

        let updatePayload = { ...req.body };
        if (image_url !== undefined) {
            const targetName = name || 'item';
            updatePayload.image_url = await processMasterItemImage(image_url, targetName);
        }

        const updated = await MenuItem.updateMaster(id, updatePayload);
        if (!updated) {
            return res.status(404).json({ detail: 'Master menu item not found' });
        }

        return res.json({ detail: 'Master menu item updated successfully', item: updated });
    } catch (err) {
        console.error('❌ Error updating master menu item:', err);
        return res.status(err.statusCode || 500).json({ detail: err.message || 'Failed to update menu item' });
    }
});

// Toggle Master Menu Item Status (Active / Inactive)
router.put('/menu/:id/status', adminAuthMiddleware, adminCan('menu'), async (req, res) => {
    try {
        const { id } = req.params;
        const { is_available } = req.body;

        if (is_available === undefined) {
            return res.status(400).json({ detail: 'is_available status is required' });
        }

        const updated = await MenuItem.updateMaster(id, { is_available: Boolean(is_available) });
        if (!updated) {
            return res.status(404).json({ detail: 'Master menu item not found' });
        }

        return res.json({ detail: 'Master menu item status updated', item: updated });
    } catch (err) {
        console.error('❌ Error updating menu item status:', err);
        return res.status(500).json({ detail: 'Failed to update menu item status' });
    }
});

// Delete / Safe Deactivate Master Menu Item
router.delete('/menu/:id', adminAuthMiddleware, adminCan('menu'), async (req, res) => {
    try {
        const { id } = req.params;
        const result = await MenuItem.deleteMaster(id);

        if (!result.deleted) {
            return res.status(404).json({ detail: 'Master menu item not found' });
        }

        return res.json({
            detail: result.softDeleted
                ? `Deleted from the catalog. ${result.shopsUsing} shop${result.shopsUsing === 1 ? '' : 's'} had already added it; their past bills keep it.`
                : 'Master menu item deleted successfully.',
            softDeleted: result.softDeleted,
            shopsUsing: result.shopsUsing || 0
        });
    } catch (err) {
        console.error('❌ Error deleting master menu item:', err);
        return res.status(500).json({ detail: 'Failed to delete menu item' });
    }
});

export default router;

