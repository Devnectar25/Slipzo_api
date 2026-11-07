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

const getCachedMembership = async (userId) => {
    const cached = staffCache.get(userId);
    if (cached && (Date.now() - cached.timestamp < STAFF_CACHE_TTL)) {
        return cached.membership;
    }
    // Runs on every request: a problem here must mean "no staff access", never "nobody can log in"
    let membership = null;
    try {
        membership = await ShopStaff.findActiveByWorker(userId);
    } catch (err) {
        console.error('⚠️ Staff membership lookup failed:', err.message);
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
    return { shop_name: owner.shop?.name || owner.name || 'Shop' };
};

// Everything a worker may change: billing work only. Anything not listed is refused,
// so new routes stay owner-only until someone decides otherwise.
const STAFF_ALLOWED_WRITES = [
    /^POST \/api\/bills$/,
    /^PUT \/api\/bills\/[^/]+$/,
    /^POST \/api\/bills\/[^/]+\/print$/,
    /^POST \/api\/bills\/print-table\/[^/]+$/,
    /^POST \/api\/subscriptions\/consume-print$/,
    /^POST \/api\/customers$/,
    /^PUT \/api\/customers\/[^/]+$/,
    /^PUT \/api\/(restaurant|tables)(\/tables)?\/[^/]+$/,
    /^POST \/api\/(restaurant|tables)(\/tables)?\/reset\/[^/]+$/,
    /^POST \/api\/shop\/staff\/leave$/
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
const applyIdentity = async (req, res, user) => {
    req.user = user;
    req.authUser = user;
    const membership = await getCachedMembership(user.id);
    if (!membership) return true;

    const owner = await getCachedUser(membership.owner_user_id);
    if (!owner) return true;

    if (!isAllowedForStaff(req)) {
        res.status(403).json({ detail: 'Only the shop owner can do this.' });
        return false;
    }
    req.user = owner;
    req.staffOf = { shop_name: owner.shop?.name || owner.name || 'Shop' };
    return true;
};

export const authMiddleware = async (req, res, next) => {
    let token = req.cookies?.token;
    if (!token && req.headers.authorization) {
        const authHeader = req.headers.authorization;
        token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : authHeader;
    }
    
    if (!token) {
        return res.status(401).json({ detail: 'Authentication required' });
    }
    
    const decoded = verifyToken(token);
    if (!decoded) {
        return res.status(401).json({ detail: 'Invalid or expired token' });
    }
    
    const user = await getCachedUser(decoded.userId);
    if (!user) {
        return res.status(401).json({ detail: 'User not found' });
    }
    
    if (await applyIdentity(req, res, user)) next();
};

export const optionalAuth = async (req, res, next) => {
    let token = req.cookies?.token;
    if (!token && req.headers.authorization) {
        const authHeader = req.headers.authorization;
        token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : authHeader;
    }
    if (token) {
        try {
            const decoded = verifyToken(token);
            if (decoded) {
                const user = await getCachedUser(decoded.userId);
                if (user && !(await applyIdentity(req, res, user))) return;
            }
        } catch (_) {}
    }
    next();
};