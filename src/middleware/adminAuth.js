import jwt from 'jsonwebtoken';
import SubAdmin from '../models/SubAdmin.js';
import AdminProfile from '../models/AdminProfile.js';

const JWT_SECRET = process.env.JWT_SECRET || 'slipzo-secret-key-2024';

// Cache admin profiles briefly and invalidate immediately when updated
const subAdminCache = new Map();
const SUB_ADMIN_TTL = 30 * 1000;
let superAdminCache = null;

export const forgetSubAdmin = (id) => { if (id) subAdminCache.delete(id); else subAdminCache.clear(); };
export const forgetSuperAdmin = () => { superAdminCache = null; };

const loadSubAdmin = async (id) => {
    const hit = subAdminCache.get(id);
    if (hit && Date.now() - hit.at < SUB_ADMIN_TTL) return hit.account;
    const account = await SubAdmin.findById(id);
    subAdminCache.set(id, { account, at: Date.now() });
    return account;
};

const loadSuperAdmin = async () => {
    if (superAdminCache && Date.now() - superAdminCache.at < SUB_ADMIN_TTL) return superAdminCache.account;
    const account = await AdminProfile.getSuperAdmin();
    superAdminCache = { account, at: Date.now() };
    return account;
};

export const adminAuthMiddleware = async (req, res, next) => {
    let token = req.cookies?.slipzo_admin_token;
    if (!token && req.headers.authorization) {
        const authHeader = req.headers.authorization;
        token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : authHeader;
    }
    
    if (!token) {
        return res.status(401).json({ detail: 'Admin authentication required' });
    }
    
    let decoded;
    try {
        decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
        return res.status(401).json({ detail: 'Invalid or expired admin session token' });
    }
    if (!decoded || !decoded.isAdmin) {
        return res.status(403).json({ detail: 'Forbidden: Admin access required' });
    }

    if (decoded.subAdminId) {
        let account;
        try {
            account = await loadSubAdmin(decoded.subAdminId);
        } catch (err) {
            console.error('⚠️ Sub-admin lookup failed:', err.message);
            return res.status(503).json({ detail: 'The server is busy. Please try again.' });
        }
        if (!account || !account.active) {
            return res.status(401).json({ detail: 'This admin account has been turned off or removed.', code: 'ADMIN_REMOVED' });
        }
        req.admin = {
            ...decoded,
            id: account.id,
            isSuper: false,
            name: account.name,
            email: account.email,
            username: account.username || '',
            phone: account.phone || '',
            bio: account.bio || '',
            lastLoginAt: account.last_login_at || null,
            updatedAt: account.updated_at || null,
            role: 'Sub Admin',
            permissions: account.permissions
        };
    } else {
        let superAcc = null;
        try {
            superAcc = await loadSuperAdmin();
        } catch (err) {
            console.warn('⚠️ Super admin profile lookup fallback:', err.message);
        }
        req.admin = {
            ...decoded,
            id: 'super-admin',
            isSuper: true,
            name: superAcc?.name || 'Super Admin',
            email: superAcc?.email || decoded.email,
            username: superAcc?.username || 'admin',
            phone: superAcc?.phone || '',
            bio: superAcc?.bio || '',
            lastLoginAt: superAcc?.last_login_at || null,
            updatedAt: superAcc?.updated_at || null,
            role: 'Super Admin',
            permissions: null
        };
    }
    next();
};

/** Lets the request through for the super admin, or a sub-admin given one of these pages */
export const adminCan = (...pages) => (req, res, next) => {
    if (req.admin?.isSuper) return next();
    if (pages.some((p) => req.admin?.permissions?.includes(p))) return next();
    return res.status(403).json({ detail: 'You do not have access to this page.', code: 'NO_ADMIN_ACCESS' });
};

export const superAdminOnly = (req, res, next) => (req.admin?.isSuper
    ? next()
    : res.status(403).json({ detail: 'Only the super admin can do this.', code: 'SUPER_ADMIN_ONLY' }));
