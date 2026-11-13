import bcryptjs from 'bcryptjs';
// bcryptjs runs on the main thread and freezes the whole server for ~100 ms per password, and when many people sign in
// at once they all finish together. The native module hashes on worker threads, in order. Same hash format, so existing
// passwords keep working both ways. If the native build is not available on a host, fall back to the pure-JS one.
let bcrypt = bcryptjs;
try {
    bcrypt = (await import('bcrypt')).default;
} catch (e) {
    console.warn('⚠️ Native bcrypt unavailable, using bcryptjs (slower under load):', e.message);
}
import { v4 as uuidv4 } from 'uuid';
import { query, queryOne, insert } from '../config/database.js';
import { phoneToEmail, phoneFromEmail, isPhoneEmail } from '../utils/phone.js';

class User {
    constructor(data) {
        this.id = data.id;
        this.username = data.username || data.name;
        this.name = data.name;
        this.email = data.email;
        this.phone = data.phone || phoneFromEmail(data.email) || null;
        this.password = data.password;
        this.onboarding_reward_claimed = data.onboarding_reward_claimed !== undefined ? Number(data.onboarding_reward_claimed) : 0;
        this.prints_used = Number(data.prints_used || 0);
        this.shop = data.shop || null;
        this.created_at = data.created_at;
        this.updated_at = data.updated_at;
        this.password_changed_at = data.password_changed_at || null;
    }

    /** New password (forgot password). Sessions signed in before this moment stop working. */
    static async updatePassword(userId, newPassword) {
        const hashed = await bcrypt.hash(newPassword, 10);
        const now = new Date().toISOString();
        await query('UPDATE users SET password = ?, password_changed_at = ?, updated_at = ? WHERE id = ?', [hashed, now, now, userId]);
        return now;
    }

    static async create(userData) {
        try {
            console.log('🔐 Starting user creation');
            
            // The account ID is the mobile number; the internal address keeps email-keyed features working
            const phone = userData.phone || null;
            const email = String(userData.email || (phone ? phoneToEmail(phone) : '')).toLowerCase().trim();

            if (phone) {
                const phoneTaken = await queryOne('SELECT id FROM users WHERE phone = ? OR LOWER(email) = ?', [phone, phoneToEmail(phone)]);
                if (phoneTaken) {
                    throw Object.assign(new Error('This mobile number is already registered'), { statusCode: 400 });
                }
            }
            const emailTaken = await queryOne('SELECT id FROM users WHERE LOWER(email) = ?', [email]);
            if (emailTaken) {
                throw Object.assign(new Error(phone ? 'This email is already registered' : 'Email already registered'), { statusCode: 400 });
            }

            // Hash password
            const saltRounds = 10;
            const hashedPassword = await bcrypt.hash(userData.password, saltRounds);
            console.log('✅ Password hashed successfully');
            
            const userId = uuidv4();
            const username = (userData.username || userData.name).trim();
            const user = {
                id: userId,
                username: username,
                name: userData.name.trim(),
                email,
                phone,
                password: hashedPassword,
                onboarding_reward_claimed: 0,
                prints_used: 0
            };

            console.log('📝 Inserting user into database...');
            await insert('users', user);
            console.log('✅ User inserted successfully');
            
            // Fetch the created user to ensure it exists
            const created = await queryOne('SELECT * FROM users WHERE id = ?', [userId]);
            if (!created) {
                throw new Error('Failed to fetch created user');
            }
            
            console.log('✅ User creation completed successfully');
            return new User(created);
        } catch (err) {
            console.error('❌ User creation error:', err);
            throw err;
        }
    }

    /** Case-insensitive, because accounts created before emails were lowercased may be mixed case. */
    static async existsByEmail(email) {
        const row = await queryOne('SELECT id FROM users WHERE LOWER(email) = ?', [String(email).trim().toLowerCase()]);
        return Boolean(row);
    }

    static async findByPhone(phone) {
        try {
            const data = await queryOne('SELECT * FROM users WHERE phone = ? OR email = ?', [phone, phoneToEmail(phone)]);
            if (!data) return null;
            const shop = await queryOne('SELECT * FROM shops WHERE user_id = ?', [data.id]);
            return new User({ ...data, shop });
        } catch (error) {
            console.error('❌ Error finding user by phone:', error);
            throw error;
        }
    }

    static async findByEmail(email) {
        try {
            const data = await queryOne('SELECT * FROM users WHERE email = ?', [email.toLowerCase().trim()]);
            if (data) {
                console.log('✅ User found by email:', email);
                const shop = await queryOne('SELECT * FROM shops WHERE user_id = ?', [data.id]);
                return new User({ ...data, shop });
            }
            console.log('❌ User not found by email:', email);
            return null;
        } catch (error) {
            console.error('❌ Error finding user by email:', error);
            throw error;
        }
    }

    static async findById(id) {
        try {
            const data = await queryOne('SELECT * FROM users WHERE id = ?', [id]);
            if (data) {
                const shop = await queryOne('SELECT * FROM shops WHERE user_id = ?', [id]);
                return new User({ ...data, shop });
            }
            return null;
        } catch (error) {
            console.error('❌ Error finding user by id:', error);
            throw error;
        }
    }

    static async validatePassword(user, password) {
        try {
            console.log('🔐 Validating password for user:', user.id);
            
            const isValid = await bcrypt.compare(password, user.password);
            console.log('🔐 Password validation result:', isValid);
            
            return isValid;
        } catch (error) {
            console.error('❌ Password validation error:', error);
            return false;
        }
    }

    toJSON() {
        const { password, password_changed_at, ...userWithoutPassword } = this;
        // The internal address of a mobile-number account is not something to show or send to the app
        if (isPhoneEmail(userWithoutPassword.email)) userWithoutPassword.email = '';
        return userWithoutPassword;
    }
}

export default User;