import User from '../models/User.js';
import { verifyToken } from '../utils/helpers.js';

export const authMiddleware = async (req, res, next) => {
    const token = req.cookies?.token;
    
    if (!token) {
        return res.status(401).json({ detail: 'Authentication required' });
    }
    
    const decoded = verifyToken(token);
    if (!decoded) {
        return res.status(401).json({ detail: 'Invalid or expired token' });
    }
    
    const user = await User.findById(decoded.userId);
    if (!user) {
        return res.status(401).json({ detail: 'User not found' });
    }
    
    req.user = user;
    next();
};