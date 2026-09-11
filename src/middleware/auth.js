import User from '../models/User.js';
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
    
    req.user = user;
    next();
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
                if (user) req.user = user;
            }
        } catch (_) {}
    }
    next();
};