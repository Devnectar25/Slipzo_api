import User from '../models/User.js';
import Otp, { OTP_PURPOSES } from '../models/Otp.js';
import { clearUserAuthCache } from '../middleware/auth.js';
import { normalizePhone } from '../utils/phone.js';

// No SMS provider is connected yet, so the code is sent back to the app and shown on screen ("demo code").
// Once SMS sending is added, set OTP_DEMO_MODE=false so the code is never returned.
const demoMode = () => process.env.OTP_DEMO_MODE !== 'false';
const maskPhone = (p) => `+91 ${p.slice(0, 2)}******${p.slice(-2)}`;

const PASSWORD_RULES = [/.{8,}/, /[A-Z]/, /[a-z]/, /[0-9]/, /[#?!@$%^&*+\-=_~`(){}[\]|\\:;"'<>,./]/];

const send = (res, err, next) => {
    if (err?.statusCode) {
        return res.status(err.statusCode).json({
            detail: err.message,
            code: err.code,
            ...(err.retry_after ? { retry_after: err.retry_after } : {}),
            ...(err.tries_left !== undefined ? { tries_left: err.tries_left } : {})
        });
    }
    return next(err);
};

/**
 * POST /api/auth/otp/send  { phone, purpose: "register" | "reset" }
 * Sign up: only for a number with no account yet. Forgot password: only for a number that has an account.
 */
export const sendOtp = async (req, res, next) => {
    try {
        const phone = normalizePhone(req.body?.phone);
        const purpose = String(req.body?.purpose || '');
        if (!phone) return res.status(400).json({ detail: 'Please enter a valid 10-digit mobile number' });
        if (!OTP_PURPOSES.includes(purpose)) return res.status(400).json({ detail: 'Unknown verification type.', code: 'OTP_BAD_PURPOSE' });

        const existing = await User.findByPhone(phone);
        if (purpose === 'register' && existing) {
            return res.status(409).json({ detail: 'This mobile number is already registered', code: 'MOBILE_TAKEN' });
        }
        if (purpose === 'reset' && !existing) {
            return res.status(404).json({ detail: 'No account found with this mobile number.', code: 'NO_ACCOUNT' });
        }

        const { code, expiresIn, resendIn } = await Otp.issue(phone, purpose);
        // (an SMS provider would send `code` here)
        res.json({
            sent: true,
            phone_masked: maskPhone(phone),
            expires_in: expiresIn,
            resend_in: resendIn,
            demo: demoMode(),
            ...(demoMode() ? { demo_code: code } : {})
        });
    } catch (err) {
        send(res, err, next);
    }
};

/** POST /api/auth/otp/verify  { phone, purpose, code } -> { verified, otp_token } */
export const verifyOtp = async (req, res, next) => {
    try {
        const phone = normalizePhone(req.body?.phone);
        const purpose = String(req.body?.purpose || '');
        if (!phone) return res.status(400).json({ detail: 'Please enter a valid 10-digit mobile number' });
        if (!OTP_PURPOSES.includes(purpose)) return res.status(400).json({ detail: 'Unknown verification type.', code: 'OTP_BAD_PURPOSE' });

        const otpToken = await Otp.verify(phone, purpose, req.body?.code);
        res.json({ verified: true, otp_token: otpToken });
    } catch (err) {
        send(res, err, next);
    }
};

/**
 * POST /api/auth/password/reset  { phone, otp_token, password }
 * Sets a new password after the phone was verified. Every device signed in with the old password is signed out.
 */
export const resetPassword = async (req, res, next) => {
    try {
        const phone = normalizePhone(req.body?.phone);
        const password = String(req.body?.password || '');
        if (!phone) return res.status(400).json({ detail: 'Please enter a valid 10-digit mobile number' });

        const proof = Otp.checkToken(req.body?.otp_token, phone, 'reset');
        if (!proof) {
            return res.status(400).json({ detail: 'Your verification has expired. Please start again.', code: 'OTP_REQUIRED' });
        }
        if (!PASSWORD_RULES.every((rule) => rule.test(password))) {
            return res.status(400).json({
                detail: 'Password must be at least 8 characters and include uppercase, lowercase, number, and special character'
            });
        }

        const user = await User.findByPhone(phone);
        if (!user) return res.status(404).json({ detail: 'No account found with this mobile number.', code: 'NO_ACCOUNT' });
        // one verification sets one password: it cannot be used again after the password has changed
        if (user.password_changed_at && new Date(user.password_changed_at).getTime() >= proof.iat * 1000) {
            return res.status(400).json({ detail: 'Your verification has expired. Please start again.', code: 'OTP_REQUIRED' });
        }
        if (await User.validatePassword(user, password)) {
            return res.status(400).json({ detail: 'Please choose a password you have not used for this account.', code: 'SAME_PASSWORD' });
        }

        await User.updatePassword(user.id, password);
        clearUserAuthCache(user.id);
        res.json({ message: 'Password changed. Please sign in with your new password.', phone });
    } catch (err) {
        send(res, err, next);
    }
};
