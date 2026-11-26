import crypto from 'crypto';
import rateLimit from 'express-rate-limit';

export const isProduction = () =>
    process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);

let devEphemeralJwtSecret = null;

/**
 * Resolves the JWT signing secret.
 * Never falls back to a hardcoded static string: fails fast in production if missing,
 * and generates a per-process random secret in local development.
 */
export const getJwtSecret = () => {
    const configured = process.env.JWT_SECRET ? String(process.env.JWT_SECRET).trim() : '';
    if (configured) return configured;

    if (isProduction()) {
        throw new Error('FATAL: JWT_SECRET environment variable must be set in production.');
    }

    if (!devEphemeralJwtSecret) {
        devEphemeralJwtSecret = crypto.randomBytes(32).toString('hex');
        console.warn('⚠️ [security] JWT_SECRET not set — generated ephemeral dev secret for this process only.');
    }
    return devEphemeralJwtSecret;
};

export const getAdminCookieOptions = () => {
    const prod = isProduction();
    return {
        httpOnly: true,
        secure: prod,
        sameSite: prod ? 'none' : 'lax',
        path: '/'
    };
};

/**
 * Checks whether an admin JWT was invalidated by a subsequent password change.
 */
export const isAdminSessionRevoked = (decoded, account) => {
    if (!account?.password_changed_at) return false;
    return decoded?.sv !== account.password_changed_at;
};

export const authStrictLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 25,
    standardHeaders: true,
    legacyHeaders: false,
    message: { detail: 'Too many authentication attempts. Please try again in 15 minutes.' }
});

export const adminLoginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    skipSuccessfulRequests: true,
    standardHeaders: true,
    legacyHeaders: false,
    message: { detail: 'Too many failed admin login attempts. Please try again in 15 minutes.' }
});

export const publicFormLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { detail: 'Too many submissions. Please wait a few minutes and try again.' }
});

/**
 * Blocks browser-initiated cross-site state-changing requests authenticated solely via cookies
 * (without an Authorization Bearer token), mitigating CSRF while leaving Capacitor/native clients unaffected.
 */
export const createCsrfOriginMiddleware = (allowedOrigins, isLocalOrigin) => (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

    const hasAuthHeader = Boolean(req.headers.authorization && req.headers.authorization.trim());
    if (hasAuthHeader) return next();

    const hasSessionCookie = Boolean(req.cookies?.token || req.cookies?.slipzo_admin_token);
    if (!hasSessionCookie) return next();

    const secFetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase();
    if (secFetchSite === 'cross-site') {
        const origin = req.headers.origin;
        if (!origin || (!allowedOrigins.includes(origin) && !isLocalOrigin(origin))) {
            return res.status(403).json({ detail: 'Cross-site request blocked.' });
        }
    }

    let reqOrigin = req.headers.origin;
    if (!reqOrigin && req.headers.referer) {
        try {
            reqOrigin = new URL(req.headers.referer).origin;
        } catch (_) {
            reqOrigin = null;
        }
    }

    if (reqOrigin && !allowedOrigins.includes(reqOrigin) && !isLocalOrigin(reqOrigin)) {
        return res.status(403).json({ detail: 'Untrusted request origin blocked.' });
    }

    next();
};
