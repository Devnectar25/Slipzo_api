import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { isPhoneEmail, phoneFromEmail } from '../utils/phone.js';
import { query, queryOne, insert, update, deleteById } from '../config/database.js';

const INVITE_VALID_DAYS = 7;
const MAX_FAILED_ATTEMPTS = 5;
// No 0/O or 1/I, so a code read out loud or typed by hand cannot be confused
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const normalizeCode = (code) => String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const hashCode = (code) => crypto.createHash('sha256').update(normalizeCode(code)).digest('hex');

const generateCode = () => {
    const chars = Array.from({ length: 8 }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]);
    return `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
};

const newInviteFields = () => {
    const code = generateCode();
    return {
        code,
        fields: {
            invite_code_hash: hashCode(code),
            invite_expires_at: new Date(Date.now() + INVITE_VALID_DAYS * 24 * 60 * 60 * 1000).toISOString(),
            failed_attempts: 0
        }
    };
};

// What the owner sees; the code hash never leaves the server
const toPublic = (row) => ({
    id: row.id,
    email: isPhoneEmail(row.email) ? '' : row.email,
    phone: phoneFromEmail(row.email),
    status: row.status,
    invite_expired: row.status === 'pending' && (!row.invite_code_hash || new Date(row.invite_expires_at) < new Date()),
    created_at: row.created_at,
    accepted_at: row.accepted_at || null
});

export default class ShopStaff {
    static async listForOwner(ownerId) {
        const rows = await query('SELECT * FROM shop_staff WHERE owner_user_id = ? ORDER BY created_at DESC', [ownerId]);
        return (rows || []).map(toPublic);
    }

    static async findForOwner(id, ownerId) {
        return await queryOne('SELECT * FROM shop_staff WHERE id = ? AND owner_user_id = ?', [id, ownerId]);
    }

    static async findByOwnerAndEmail(ownerId, email) {
        return await queryOne('SELECT id FROM shop_staff WHERE owner_user_id = ? AND email = ?', [ownerId, email]);
    }

    static async countForOwner(ownerId) {
        const row = await queryOne('SELECT COUNT(*) AS total FROM shop_staff WHERE owner_user_id = ?', [ownerId]);
        return Number(row?.total || 0);
    }

    static async hasActiveWorkers(ownerId) {
        const row = await queryOne("SELECT id FROM shop_staff WHERE owner_user_id = ? AND status = 'active' LIMIT 1", [ownerId]);
        return Boolean(row);
    }

    /** Active membership of a worker, or null. */
    static async findActiveByWorker(workerId) {
        return await queryOne("SELECT * FROM shop_staff WHERE worker_user_id = ? AND status = 'active' ORDER BY accepted_at DESC, created_at DESC LIMIT 1", [workerId]);
    }

    static async invite(ownerId, email) {
        const { code, fields } = newInviteFields();
        const row = {
            id: uuidv4(),
            owner_user_id: ownerId,
            email,
            status: 'pending',
            created_at: new Date().toISOString(),
            ...fields
        };
        await insert('shop_staff', row);
        return { member: toPublic(row), code };
    }

    static async regenerate(row) {
        const { code, fields } = newInviteFields();
        await update('shop_staff', fields, 'id = ?', [row.id]);
        return { member: toPublic({ ...row, ...fields }), code };
    }

    /**
     * Accepts an invite only for the logged-in user's own email with the right code.
     * Returns { member } or { error } with a message safe to show.
     */
    static async join(worker, code) {
        const invalid = { error: 'That invite code is not valid for this account. Check the code and that you are logged in with the invited mobile number or email.' };
        const email = String(worker.email || '').trim().toLowerCase();
        const rows = await query("SELECT * FROM shop_staff WHERE email = ? AND status = 'pending'", [email]);
        const pending = (rows || []).filter((r) => r.invite_code_hash);
        if (pending.length === 0) return invalid;

        const given = Buffer.from(hashCode(code));
        const match = pending.find((r) => crypto.timingSafeEqual(given, Buffer.from(r.invite_code_hash)));

        if (!match) {
            // Guessing is cut off per invite, so a code cannot be brute-forced
            for (const r of pending) {
                const attempts = Number(r.failed_attempts || 0) + 1;
                await update('shop_staff', {
                    failed_attempts: attempts,
                    ...(attempts >= MAX_FAILED_ATTEMPTS ? { invite_code_hash: null } : {})
                }, 'id = ?', [r.id]);
            }
            return invalid;
        }

        if (new Date(match.invite_expires_at) < new Date()) {
            return { error: 'This invite code has expired. Ask the shop owner for a new one.' };
        }

        await update('shop_staff', {
            status: 'active',
            worker_user_id: worker.id,
            invite_code_hash: null,
            accepted_at: new Date().toISOString()
        }, 'id = ?', [match.id]);
        return { member: toPublic({ ...match, status: 'active' }), ownerId: match.owner_user_id };
    }

    static async remove(id) {
        return await deleteById('shop_staff', id);
    }
}
