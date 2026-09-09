import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { query, queryOne, insert } from '../config/database.js';

class User {
    constructor(data) {
        this.id = data.id;
        this.email = data.email;
        this.password = data.password;
        this.name = data.name;
        this.created_at = data.created_at;
        this.updated_at = data.updated_at;
    }

    static async create(userData) {
        try {
            console.log('🔐 Starting user creation for:', userData.email);
            
            // Check if user exists
            const existing = await queryOne('SELECT id FROM users WHERE email = ?', [userData.email]);
            if (existing) {
                console.log('❌ Email already registered:', userData.email);
                throw new Error('Email already registered');
            }

            // Hash password
            const saltRounds = 10;
            const hashedPassword = await bcrypt.hash(userData.password, saltRounds);
            console.log('✅ Password hashed successfully');
            
            const userId = uuidv4();
            const user = {
                id: userId,
                email: userData.email.toLowerCase().trim(),
                password: hashedPassword,
                name: userData.name.trim()
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

    static async findByEmail(email) {
        try {
            const data = await queryOne('SELECT * FROM users WHERE email = ?', [email.toLowerCase().trim()]);
            if (data) {
                console.log('✅ User found by email:', email);
                return new User(data);
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
                return new User(data);
            }
            return null;
        } catch (error) {
            console.error('❌ Error finding user by id:', error);
            throw error;
        }
    }

    static async validatePassword(user, password) {
        try {
            console.log('🔐 Validating password for user:', user.email);
            console.log('🔐 Password provided length:', password.length);
            console.log('🔐 Stored hash length:', user.password.length);
            
            const isValid = await bcrypt.compare(password, user.password);
            console.log('🔐 Password validation result:', isValid);
            
            return isValid;
        } catch (error) {
            console.error('❌ Password validation error:', error);
            return false;
        }
    }

    toJSON() {
        const { password, ...userWithoutPassword } = this;
        return userWithoutPassword;
    }
}

export default User;