import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { query, queryOne, insert } from '../config/database.js';

// One-time codes sent to a phone: sign up ("register") and forgot password ("reset").
// Codes are stored hashed, live 10 minutes, allow 5 wrong tries, and a new one can be asked for after 30 seconds.
export const OTP_PURPOSES = ['register', 'reset'];
const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_AFTER_MS = 30 * 1000;
const MAX_TRIES = 5;
const MAX_CODES_PER_HOUR = 6;
const TOKEN_TTL = '15m';

const SECRET = process.env.JWT_SECRET || 'slipzo-secret-key-2024';
const fail = (message, statusCode, code, extra = {}) => Object.assign(new Error(message), { statusCode, code, ...extra });
const hashCode = (phone, purpose, code) =>
    crypto.createHmac('sha256', SECRET).update(`${phone}:${purpose}:${code}`).digest('hex');
const sameHash = (a, b) => {
    const x = Buffer.from(String(a), 'hex');
    const y = Buffer.from(String(b), 'hex');
    return x.length === y.length && crypto.timingSafeEqual(x, y);
};

export default class Otp {
    /** Makes a new code for this phone (older unused codes stop working). Returns the code itself. */
    static async issue(phone, purpose) {
        if (!OTP_PURPOSES.includes(purpose)) throw fail('Unknown verification type.', 400, 'OTP_BAD_PURPOSE');
        const now = Date.now();

        const last = await queryOne(
            'SELECT created_at FROM otp_codes WHERE phone = ? AND purpose = ? ORDER BY created_at DESC LIMIT 1',
            [phone, purpose]
        );
        const lastAt = last ? new Date(last.created_at).getTime() : 0;
        if (lastAt && now - lastAt < RESEND_AFTER_MS) {
            const wait = Math.ceil((RESEND_AFTER_MS - (now - lastAt)) / 1000);
            throw fail(`Please wait ${wait} seconds before asking for a new code.`, 429, 'OTP_COOLDOWN', { retry_after: wait });
        }
        const recent = await queryOne(
            'SELECT COUNT(*) AS n FROM otp_codes WHERE phone = ? AND purpose = ? AND created_at > ?',
            [phone, purpose, new Date(now - 60 * 60 * 1000).toISOString()]
        );
        if (Number(recent?.n || 0) >= MAX_CODES_PER_HOUR) {
            throw fail('Too many codes asked for this number. Please try again in an hour.', 429, 'OTP_TOO_MANY');
        }

        await query(
            'UPDATE otp_codes SET used_at = ? WHERE phone = ? AND purpose = ? AND used_at IS NULL',
            [new Date(now).toISOString(), phone, purpose]
        );
        const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
        await insert('otp_codes', {
            id: uuidv4(),
            phone,
            purpose,
            code_hash: hashCode(phone, purpose, code),
            attempts: 0,
            expires_at: new Date(now + CODE_TTL_MS).toISOString(),
            used_at: null,
            created_at: new Date(now).toISOString()
        });
        return { code, expiresIn: CODE_TTL_MS / 1000, resendIn: RESEND_AFTER_MS / 1000 };
    }

    /** Checks a code. Right: returns a short-lived token that proves this phone was verified for this purpose. */
    static async verify(phone, purpose, code) {
        const clean = String(code || '').replace(/\D/g, '');
        if (clean.length !== 6) throw fail('Enter the 6-digit code.', 400, 'OTP_FORMAT');

        const row = await queryOne(
            'SELECT * FROM otp_codes WHERE phone = ? AND purpose = ? AND used_at IS NULL ORDER BY created_at DESC LIMIT 1',
            [phone, purpose]
        );
        if (!row || new Date(row.expires_at).getTime() < Date.now()) {
            throw fail('This code has expired. Please ask for a new one.', 400, 'OTP_EXPIRED');
        }
        const tries = Number(row.attempts || 0);
        if (tries >= MAX_TRIES) {
            throw fail('Too many wrong tries. Please ask for a new code.', 429, 'OTP_LOCKED');
        }
        if (!sameHash(row.code_hash, hashCode(phone, purpose, clean))) {
            await query('UPDATE otp_codes SET attempts = ? WHERE id = ?', [tries + 1, row.id]);
            const left = MAX_TRIES - tries - 1;
            if (left <= 0) throw fail('Too many wrong tries. Please ask for a new code.', 429, 'OTP_LOCKED');
            throw fail(`That code is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.`, 400, 'OTP_WRONG', { tries_left: left });
        }

        await query('UPDATE otp_codes SET used_at = ? WHERE id = ?', [new Date().toISOString(), row.id]);
        return jwt.sign({ kind: 'otp', phone, purpose }, SECRET, { expiresIn: TOKEN_TTL });
    }

    /** The token's details when it came from a correct code for this phone and purpose (and is still fresh), else null */
    static checkToken(token, phone, purpose) {
        if (!token) return null;
        try {
            const data = jwt.verify(String(token), SECRET);
            return data?.kind === 'otp' && data.phone === phone && data.purpose === purpose ? data : null;
        } catch (_) {
            return null;
        }
    }
}
