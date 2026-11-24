import User from '../models/User.js';
import ShopStaff from '../models/ShopStaff.js';
import { verifyToken } from '../utils/helpers.js';

// Fast in-memory user cache to eliminate 150-300ms DB roundtrip on every API request
const userCache = new Map();
const USER_CACHE_TTL = 60 * 1000;

export const clearUserAuthCache = (userId) => {
    if (userId) userCache.delete(userId);
    else userCache.clear();
};

const getCachedUser = async (userId) => {
    const cached = userCache.get(userId);
    if (cached && (Date.now() - cached.timestamp < USER_CACHE_TTL)) {
        return cached.user;
    }
    const user = await User.findById(userId);
    if (user) {
        userCache.set(userId, { user, timestamp: Date.now() });
    }
    return user;
};

// Worker -> shop membership, cached because it is checked on every request.
// A revoked worker loses access within this window on any other server instance.
const staffCache = new Map();
const STAFF_CACHE_TTL = 30 * 1000;

export const clearStaffCache = (userId) => {
    if (userId) staffCache.delete(userId);
    else staffCache.clear();
};

const STAFF_LAST_KNOWN = 10 * 60 * 1000;
const getCachedMembership = async (userId, { fresh = false } = {}) => {
    const cached = staffCache.get(userId);
    if (!fresh && cached && (Date.now() - cached.timestamp < STAFF_CACHE_TTL)) {
        return cached.membership;
    }
    let membership = null;
    try {
        membership = await ShopStaff.findActiveByWorker(userId);
    } catch (err) {
        console.error('⚠️ Staff membership lookup failed:', err.message);
        // No such table: this database has no workers at all. Any other problem must never turn a worker into "the owner
        // of their own shop": their bills and prints would land on the wrong account. The last known answer is used, or
        // the request is refused so the app tries again.
        const noStaffTable = err.code === '42P01' || /no such table/i.test(err.message || '');
        if (!noStaffTable) {
            if (cached && Date.now() - cached.timestamp < STAFF_LAST_KNOWN) return cached.membership;
            throw err;
        }
    }
    staffCache.set(userId, { membership, timestamp: Date.now() });
    return membership;
};

/** What the app needs to know about a worker's shop; null for everyone else. */
export const getStaffContext = async (userId) => {
    const membership = await getCachedMembership(userId);
    if (!membership) return null;
    const owner = await getCachedUser(membership.owner_user_id);
    if (!owner) return null;
    return { shop_name: owner.shop?.name || owner.name || 'Shop', shop_id: owner.id };
};

// Everything a worker may change: billing work only. Anything not listed is refused,
// so new routes stay owner-only until someone decides otherwise.
const STAFF_ALLOWED_WRITES = [
    /^POST \/api\/bills$/,
    /^PUT \/api\/bills\/[^/]+$/,
    /^POST \/api\/bills\/[^/]+\/print$/,
    /^POST \/api\/bills\/print-table\/[^/]+$/,
    /^POST \/api\/bills\/print-(claim|release)$/,
    /^POST \/api\/subscriptions\/consume-print$/,
    /^POST \/api\/customers$/,
    /^PUT \/api\/customers\/[^/]+$/,
    /^PUT \/api\/(restaurant|tables)(\/tables)?\/[^/]+$/,
    /^POST \/api\/(restaurant|tables)(\/tables)?\/reset\/[^/]+$/,
    /^POST \/api\/shop\/staff\/leave$/,
    /^POST \/api\/push\/(register|unregister)$/,
    /^POST \/api\/notifications\/read$/
];

const isAllowedForStaff = (req) => {
    const path = req.originalUrl.split('?')[0].replace(/\/+$/, '');
    if (req.method === 'GET') return !path.startsWith('/api/shop/staff');
    const signature = `${req.method} ${path}`;
    return STAFF_ALLOWED_WRITES.some((rule) => rule.test(signature));
};

/**
 * All data is keyed on req.user.id, so a worker simply acts as the shop owner from here on.
 * req.authUser always holds the person who is actually logged in.
 * Returns false if a response was already sent.
 */
const shopOwnerFor = async (user, options) => {
    const membership = await getCachedMembership(user.id, options);
    return membership ? await getCachedUser(membership.owner_user_id) : null;
};

const applyIdentity = async (req, res, user) => {
    req.user = user;
    req.authUser = user;
    const path = req.originalUrl.split('?')[0].replace(/\/+$/, '');
    // "who am I" is always asked fresh: the app decides by it which shop's data it shows
    let owner = await shopOwnerFor(user, { fresh: path === '/api/auth/me' });

    // The app says which shop it is billing for. A worker who was removed (or joined another shop) while a bill was open
    // must not save that bill on the wrong account.
    const expected = req.body && typeof req.body === 'object' ? req.body.acting_shop : undefined;
    if (expected !== undefined) {
        delete req.body.acting_shop;
        if (String(expected) !== String((owner || user).id)) owner = await shopOwnerFor(user, { fresh: true });
        if (String(expected) !== String((owner || user).id)) {
            res.status(409).json({ code: 'SHOP_CHANGED', detail: 'Your shop access has changed. Please check the shop name and try again.' });
            return false;
        }
    }
    if (!owner) return true;

    if (!isAllowedForStaff(req)) {
        res.status(403).json({ detail: 'Only the shop owner can do this.' });
        return false;
    }
    req.user = owner;
    req.staffOf = { shop_name: owner.shop?.name || owner.name || 'Shop', shop_id: owner.id };
    return true;
};

const extractToken = (req) => {
    if (req.headers.authorization) {
        const authHeader = req.headers.authorization;
        const headerToken = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : authHeader;
        if (headerToken && headerToken !== 'null' && headerToken !== 'undefined') {
            return headerToken;
        }
    }
    return req.cookies?.token || null;
};

// A token from before the last password change (forgot password) no longer signs anyone in.
// Tokens carry whole seconds, so one issued in the same second as the change still counts.
export const signedInBeforePasswordChange = (decoded, user) => {
    if (!user?.password_changed_at || !decoded?.iat) return false;
    const changed = new Date(user.password_changed_at).getTime();
    return Number.isFinite(changed) && (decoded.iat + 1) * 1000 <= changed;
};

export const authMiddleware = async (req, res, next) => {
    const token = extractToken(req);
    
    if (!token) {
        return res.status(401).json({ detail: 'Authentication required' });
    }
    
    const decoded = verifyToken(token);
    if (!decoded) {
        return res.status(401).json({ detail: 'Invalid or expired token' });
    }
    
    let allowed = false;
    try {
        const user = await getCachedUser(decoded.userId);
        if (!user) {
            return res.status(401).json({ detail: 'User not found' });
        }
        if (signedInBeforePasswordChange(decoded, user)) {
            return res.status(401).json({ detail: 'Your password was changed. Please sign in again.', code: 'PASSWORD_CHANGED' });
        }
        allowed = await applyIdentity(req, res, user);
    } catch (err) {
        // the account could not be read right now: nothing is done rather than something on the wrong account
        console.error('⚠️ Could not check the account:', err.message);
        return res.status(503).json({ code: 'TRY_AGAIN', detail: 'The server is busy. Please try again.' });
    }
    if (allowed) next();
};

export const optionalAuth = async (req, res, next) => {
    const token = extractToken(req);
    if (token) {
        try {
            const decoded = verifyToken(token);
            if (decoded) {
                const user = await getCachedUser(decoded.userId);
                if (user && signedInBeforePasswordChange(decoded, user)) return next();
                if (user && !(await applyIdentity(req, res, user))) return;
            }
        } catch (_) {}
    }
    next();
};