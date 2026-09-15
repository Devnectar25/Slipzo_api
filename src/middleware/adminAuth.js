import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'slipzo-secret-key-2024';

export const adminAuthMiddleware = async (req, res, next) => {
    let token = req.cookies?.slipzo_admin_token;
    if (!token && req.headers.authorization) {
        const authHeader = req.headers.authorization;
        token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : authHeader;
    }
    
    if (!token) {
        return res.status(401).json({ detail: 'Admin authentication required' });
    }
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (!decoded || !decoded.isAdmin) {
            return res.status(403).json({ detail: 'Forbidden: Admin access required' });
        }
        req.admin = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ detail: 'Invalid or expired admin session token' });
    }
};
