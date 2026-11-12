import User from '../models/User.js';
import { getStaffContext } from '../middleware/auth.js';
import Shop from '../models/Shop.js';
import Subscription from '../models/Subscription.js';
import Template from '../models/Template.js';
import { generateToken } from '../utils/helpers.js';
import { normalizePhone, isPhoneEmail } from '../utils/phone.js';

export const checkAvailability = async (req, res, next) => {
    try {
        const { phone: rawPhone, email } = req.body || {};
        const phone = rawPhone ? normalizePhone(rawPhone) : null;

        if (!rawPhone || !phone) {
            return res.status(400).json({ detail: 'Please enter a valid 10-digit mobile number' });
        }

        const existing = await User.findByPhone(phone);
        if (existing) {
            const quota = await Subscription.getQuotaByUserId(existing.id);
            const worksForAShop = await getStaffContext(existing.id);
            const unfinished = quota.isFreeTier && !quota.onboardingRewardClaimed && !worksForAShop;
            if (unfinished) {
                return res.status(409).json({
                    detail: 'You already started signing up with this mobile number. Sign in with the password you chose to continue.',
                    code: 'SIGNUP_IN_PROGRESS'
                });
            }
            return res.status(409).json({
                detail: 'This mobile number is already registered',
                code: 'MOBILE_TAKEN'
            });
        }

        const trimmedEmail = typeof email === 'string' ? email.trim() : '';
        if (trimmedEmail && await User.existsByEmail(trimmedEmail)) {
            return res.status(409).json({
                detail: 'This email is already registered',
                code: 'EMAIL_TAKEN'
            });
        }

        return res.json({ available: true });
    } catch (error) {
        next(error);
    }
};

export const register = async (req, res, next) => {
    try {
        console.log('📝 Registration request received');
        const { password, name } = req.body;

        if (!req.body.phone || !password || !name) {
            console.log('❌ Missing required fields');
            return res.status(400).json({
                detail: 'Mobile number, password, and name are required'
            });
        }

        const phone = normalizePhone(req.body.phone);
        if (!phone) {
            console.log('❌ Invalid mobile number');
            return res.status(400).json({
                detail: 'Please enter a valid 10-digit mobile number'
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

        // Shop name and email come with the sign-up form. The email is optional.
        const shopName = String(req.body.shop_name || '').trim();
        if (shopName && (shopName.length < 2 || shopName.length > 100)) {
            return res.status(400).json({ detail: 'Shop name must be between 2 and 100 characters' });
        }
        const email = String(req.body.email || '').trim().toLowerCase();
        if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || isPhoneEmail(email))) {
            return res.status(400).json({ detail: 'Please enter a valid email address or leave it blank' });
        }

        // Someone who started signing up but left before choosing a plan comes back with the same number.
        // Their account exists but is unfinished (nothing bought, setup not done). With the same password they simply carry on;
        // with a different one nothing changes, because without a code sent to the phone this must not become a way into the account.
        const existing = await User.findByPhone(phone);
        if (existing) {
            const quota = await Subscription.getQuotaByUserId(existing.id);
            const worksForAShop = await getStaffContext(existing.id);
            const unfinished = quota.isFreeTier && !quota.onboardingRewardClaimed && !worksForAShop;
            if (unfinished) {
                const samePassword = await User.validatePassword(existing, password);
                if (!samePassword) {
                    return res.status(409).json({
                        detail: 'You already started signing up with this mobile number. Sign in with the password you chose to continue.',
                        code: 'SIGNUP_IN_PROGRESS'
                    });
                }
                // The details typed this time replace the ones from the first try
                try {
                    const rawType = String(req.body.business_type || '').trim().toLowerCase();
                    const allowedTypes = ['small_business', 'kirana_grocery', 'clothing_garments', 'hotel_food'];
                    const updates = {};
                    if (shopName) updates.name = shopName;
                    if (allowedTypes.includes(rawType)) updates.business_type = rawType;
                    if (Object.keys(updates).length > 0) await Shop.update(existing.id, updates);
                } catch (shopError) {
                    console.warn('⚠️ Could not update shop details while resuming sign up:', shopError.message);
                }
                const resumed = await User.findByPhone(phone);
                const resumeToken = generateToken(existing.id);
                res.cookie('token', resumeToken, {
                    ...getTokenCookieOptions(),
                    maxAge: 7 * 24 * 60 * 60 * 1000
                });
                console.log('↩️ Sign up resumed for unfinished account:', existing.id);
                return res.status(200).json({ ...resumed.toJSON(), staff_of: await getStaffContext(existing.id), token: resumeToken, resumed: true });
            }
            // A finished account falls through to the normal "already registered" answer below
        }

        console.log('✅ Validation passed, creating user...');

        // Create user
        const user = await User.create({ phone, password, name, ...(email ? { email } : {}) });
        console.log('✅ User created:', user.id);

        // Create default shop
        try {
            const rawType = String(req.body.business_type || '').trim().toLowerCase();
            const allowedTypes = ['small_business', 'kirana_grocery', 'clothing_garments', 'hotel_food'];
            const business_type = allowedTypes.includes(rawType) ? rawType : 'small_business';

            await Shop.create({
                user_id: user.id,
                name: shopName || `${name}'s Shop`,
                phone,
                business_type
            });
            console.log('✅ Default shop created with category:', business_type);
        } catch (shopError) {
            console.error('❌ Shop creation error:', shopError);
            // Continue even if shop creation fails - user still exists
        }



        // Generate token
        const token = generateToken(user.id);
        console.log('✅ Token generated');
        
        res.cookie('token', token, {
            ...getTokenCookieOptions(),
            maxAge: 7 * 24 * 60 * 60 * 1000
        });

        const userData = { ...user.toJSON(), staff_of: await getStaffContext(user.id), token };
        console.log('✅ Registration complete, returning user data');
        res.status(201).json(userData);
    } catch (err) {
        console.error('❌ Registration error:', err);
        next(err);
    }
};

export const login = async (req, res, next) => {
    try {
        console.log('🔐 Login request received');
        const { password } = req.body;
        // Mobile number is the sign-in ID. An email is still accepted so accounts made before this change can get in.
        const identifier = String(req.body.phone ?? req.body.email ?? '').trim();

        if (!identifier || !password) {
            console.log('❌ Missing mobile number or password');
            return res.status(400).json({
                detail: 'Mobile number and password are required'
            });
        }

        let user = null;
        if (identifier.includes('@')) {
            user = await User.findByEmail(identifier);
        } else {
            const phone = normalizePhone(identifier);
            if (!phone) {
                return res.status(400).json({ detail: 'Please enter a valid 10-digit mobile number' });
            }
            user = await User.findByPhone(phone);
        }
        if (!user) {
            console.log('❌ User not found');
            return res.status(401).json({ detail: 'Invalid credentials' });
        }
        console.log('✅ User found:', user.id);

        console.log('🔐 Validating password...');
        const isValidPassword = await User.validatePassword(user, password);
        if (!isValidPassword) {
            console.log('❌ Invalid password for user:', user.id);
            return res.status(401).json({ detail: 'Invalid credentials' });
        }
        console.log('✅ Password validated');


        // Ensure user has a default shop attached
        if (!user.shop) {
            try {
                const shop = await Shop.create({
                    user_id: user.id,
                    name: `${user.name || 'My'}'s Shop`
                });
                user.shop = shop;
            } catch (shopErr) {
                console.warn('⚠️ Shop creation warning during login:', shopErr.message);
            }
        }

        const token = generateToken(user.id);
        console.log('✅ Token generated');
        
        res.cookie('token', token, {
            ...getTokenCookieOptions(),
            maxAge: 7 * 24 * 60 * 60 * 1000
        });

        console.log('✅ Login successful for:', user.id);
        res.json({ ...user.toJSON(), staff_of: await getStaffContext(user.id), token });
    } catch (err) {
        console.error('❌ Login error:', err);
        next(err);
    }
};

function getTokenCookieOptions() {
    const isProd = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
    return {
        httpOnly: true,
        secure: isProd,
        sameSite: isProd ? 'none' : 'lax',
        path: '/'
    };
}

export const logout = (req, res) => {
    res.clearCookie('token', getTokenCookieOptions());
    res.json({ message: 'Logged out successfully' });
};

export const getMe = (req, res) => {
    // A worker's req.user is the shop owner; this must describe who is really logged in
    res.json({ ...req.authUser.toJSON(), staff_of: req.staffOf || null });
};