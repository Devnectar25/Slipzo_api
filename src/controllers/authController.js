import User from '../models/User.js';
import Shop from '../models/Shop.js';
import Template from '../models/Template.js';
import { generateToken } from '../utils/helpers.js';

export const register = async (req, res, next) => {
    try {
        console.log('📝 Registration request received:', req.body);
        const { email, password, name } = req.body;

        if (!email || !password || !name) {
            console.log('❌ Missing required fields');
            return res.status(400).json({ 
                detail: 'Email, password, and name are required' 
            });
        }

        const emailRegex = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.com$/;
        if (!emailRegex.test(email.trim())) {
            console.log('❌ Invalid email format');
            return res.status(400).json({
                detail: 'Please enter a valid email address'
            });
        }

        if (name.trim().length < 2) {
            console.log('❌ Name too short');
            return res.status(400).json({
                detail: 'Name must be at least 2 characters'
            });
        }

        // Strict password rules: 8+ chars, uppercase, lowercase, digit, special char
        const hasLength = password.length >= 8;
        const hasUpper = /[A-Z]/.test(password);
        const hasLower = /[a-z]/.test(password);
        const hasNumber = /[0-9]/.test(password);
        const hasSpecial = /[#?!@$%^&*+\-=_~`(){}[\]|\\:;"'<>,./]/.test(password);

        if (!hasLength || !hasUpper || !hasLower || !hasNumber || !hasSpecial) {
            console.log('❌ Password does not meet security requirements');
            return res.status(400).json({ 
                detail: 'Password must be at least 8 characters and include uppercase, lowercase, number, and special character' 
            });
        }

        console.log('✅ Validation passed, creating user...');

        // Create user
        const user = await User.create({ email, password, name });
        console.log('✅ User created:', user.id, user.email);

        // Create default shop
        try {
            await Shop.create({
                user_id: user.id,
                name: `${name}'s Shop`
            });
            console.log('✅ Default shop created');
        } catch (shopError) {
            console.error('❌ Shop creation error:', shopError);
            // Continue even if shop creation fails - user still exists
        }

        // Seed all UI receipt templates into database for new user
        try {
            await Template.seedDefaultTemplates(user.id);
            console.log('✅ UI Templates seeded into database');
        } catch (templateError) {
            console.error('❌ Template seeding error:', templateError);
        }


        // Generate token
        const token = generateToken(user.id);
        console.log('✅ Token generated');
        
        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000
        });

        const userData = user.toJSON();
        console.log('✅ Registration complete, returning user data');
        res.status(201).json(userData);
    } catch (err) {
        console.error('❌ Registration error:', err);
        next(err);
    }
};

export const login = async (req, res, next) => {
    try {
        console.log('🔐 Login request received:', req.body.email);
        const { email, password } = req.body;

        if (!email || !password) {
            console.log('❌ Missing email or password');
            return res.status(400).json({ 
                detail: 'Email and password are required' 
            });
        }

        console.log('🔐 Finding user by email...');
        const user = await User.findByEmail(email);
        if (!user) {
            console.log('❌ User not found:', email);
            return res.status(401).json({ detail: 'Invalid credentials' });
        }
        console.log('✅ User found:', user.id);

        console.log('🔐 Validating password...');
        const isValidPassword = await User.validatePassword(user, password);
        if (!isValidPassword) {
            console.log('❌ Invalid password for user:', email);
            return res.status(401).json({ detail: 'Invalid credentials' });
        }
        console.log('✅ Password validated');

        const token = generateToken(user.id);
        console.log('✅ Token generated');
        
        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000
        });

        console.log('✅ Login successful for:', email);
        res.json(user.toJSON());
    } catch (err) {
        console.error('❌ Login error:', err);
        next(err);
    }
};

export const logout = (req, res) => {
    res.clearCookie('token');
    res.json({ message: 'Logged out successfully' });
};

export const getMe = (req, res) => {
    res.json(req.user.toJSON());
};