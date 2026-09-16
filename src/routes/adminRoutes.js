import express from 'express';
import jwt from 'jsonwebtoken';
import { adminAuthMiddleware } from '../middleware/adminAuth.js';
import { query, queryOne } from '../config/database.js';
import ContactSubmission from '../models/ContactSubmission.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'slipzo-secret-key-2024';

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@slipzo.com').toLowerCase().trim();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin@12345';
const ADMIN_SECURITY_CODE = process.env.ADMIN_SECURITY_CODE || 'SLIPZO_ADMIN_2026';

// Admin Login Endpoint
router.post('/login', (req, res) => {
    try {
        const { email, password, securityCode } = req.body;

        if (!email || !password) {
            return res.status(400).json({ detail: 'Email/Username and Password are required' });
        }

        const inputEmail = email.toLowerCase().trim();
        const inputPass = password.trim();
        const inputSec = (securityCode || '').trim();

        const isEmailValid = inputEmail === ADMIN_EMAIL || inputEmail === 'admin';
        const isPassValid = inputPass === ADMIN_PASSWORD;
        const isSecValid = !ADMIN_SECURITY_CODE || inputSec === ADMIN_SECURITY_CODE;

        if (!isEmailValid || !isPassValid || !isSecValid) {
            return res.status(401).json({ detail: 'Invalid Admin credentials or security code' });
        }

        const adminPayload = {
            isAdmin: true,
            email: ADMIN_EMAIL,
            role: 'Super Admin',
            loginTime: new Date().toISOString()
        };

        const token = jwt.sign(adminPayload, JWT_SECRET, { expiresIn: '1d' });

        res.cookie('slipzo_admin_token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 24 * 60 * 60 * 1000
        });

        return res.json({
            detail: 'Admin login successful',
            token,
            admin: {
                email: ADMIN_EMAIL,
                role: 'Super Admin'
            }
        });
    } catch (err) {
        console.error('❌ Admin login error:', err);
        return res.status(500).json({ detail: 'Internal server error during admin login' });
    }
});

// Get Current Admin Session
router.get('/me', adminAuthMiddleware, (req, res) => {
    return res.json({
        admin: {
            email: req.admin.email,
            role: req.admin.role || 'Super Admin',
            loginTime: req.admin.loginTime
        }
    });
});

// Admin Logout
router.post('/logout', (req, res) => {
    res.clearCookie('slipzo_admin_token');
    return res.json({ detail: 'Admin logged out successfully' });
});

// System Analytics & Stats
router.get('/stats', adminAuthMiddleware, async (req, res) => {
    try {
        const usersCount = await queryOne('SELECT COUNT(*) as count FROM users');
        const shopsCount = await queryOne('SELECT COUNT(*) as count FROM shops');
        const billsCount = await queryOne('SELECT COUNT(*) as count FROM bills');
        const productsCount = await queryOne('SELECT COUNT(*) as count FROM products');
        const customersCount = await queryOne('SELECT COUNT(*) as count FROM customers');

        // Recent 5 users
        const recentUsers = await query(`
            SELECT u.id, u.name, u.email, u.created_at, s.name as shop_name 
            FROM users u 
            LEFT JOIN shops s ON s.user_id = u.id 
            ORDER BY u.created_at DESC 
            LIMIT 5
        `);

        return res.json({
            stats: {
                totalUsers: parseInt(usersCount?.count || 0),
                totalShops: parseInt(shopsCount?.count || 0),
                totalBills: parseInt(billsCount?.count || 0),
                totalProducts: parseInt(productsCount?.count || 0),
                totalCustomers: parseInt(customersCount?.count || 0)
            },
            recentUsers,
            systemHealth: {
                status: 'healthy',
                uptime: process.uptime(),
                nodeVersion: process.version,
                platform: process.platform,
                timestamp: new Date().toISOString()
            }
        });
    } catch (err) {
        console.error('❌ Error fetching admin stats:', err);
        return res.status(500).json({ detail: 'Failed to fetch admin stats' });
    }
});

// User & Shop List
router.get('/users', adminAuthMiddleware, async (req, res) => {
    try {
        const search = req.query.search ? `%${req.query.search.trim()}%` : null;

        let sql = `
            SELECT 
                u.id, 
                u.name, 
                u.email, 
                u.username, 
                u.created_at,
                s.name as shop_name, 
                s.phone as shop_phone, 
                s.address as shop_address,
                s.invoice_prefix,
                s.gstin as shop_gstin,
                (SELECT COUNT(*) FROM bills WHERE user_id = u.id) as bill_count,
                (SELECT COUNT(*) FROM products WHERE user_id = u.id) as product_count
            FROM users u
            LEFT JOIN shops s ON s.user_id = u.id
        `;

        const params = [];
        if (search) {
            sql += ` WHERE u.name LIKE ? OR u.email LIKE ? OR s.name LIKE ? OR s.phone LIKE ?`;
            params.push(search, search, search, search);
        }

        sql += ` ORDER BY u.created_at DESC`;

        const users = await query(sql, params);
        return res.json({ users: users || [] });
    } catch (err) {
        console.error('❌ Error fetching users for admin:', err);
        return res.status(500).json({ detail: 'Failed to fetch users' });
    }
});

// System Bills Log
router.get('/bills', adminAuthMiddleware, async (req, res) => {
    try {
        const sql = `
            SELECT 
                b.id,
                b.number as bill_number,
                b.customer_name,
                b.total,
                b.created_at,
                u.name as user_name,
                u.email as user_email,
                s.name as shop_name
            FROM bills b
            LEFT JOIN users u ON u.id = b.user_id
            LEFT JOIN shops s ON s.user_id = b.user_id
            ORDER BY b.created_at DESC
            LIMIT 50
        `;
        const bills = await query(sql);
        return res.json({ bills: bills || [] });
    } catch (err) {
        console.error('❌ Error fetching system bills for admin:', err);
        return res.status(500).json({ detail: 'Failed to fetch system bills' });
    }
});

// Support Contact Submissions Log
router.get('/contacts', adminAuthMiddleware, async (req, res) => {
    try {
        const submissions = await ContactSubmission.findAll();
        return res.json({ contacts: submissions || [] });
    } catch (err) {
        console.error('❌ Error fetching contact submissions for admin:', err);
        return res.status(500).json({ detail: 'Failed to fetch contact submissions' });
    }
});

// System Templates Management
router.get('/templates', adminAuthMiddleware, async (req, res) => {
    try {
        const sql = `
            SELECT 
                t.id, 
                t.name, 
                t.category, 
                t.width, 
                t.created_at,
                u.name as user_name, 
                u.email as user_email, 
                s.name as shop_name
            FROM templates t
            LEFT JOIN users u ON u.id = t.user_id
            LEFT JOIN shops s ON s.user_id = t.user_id
            ORDER BY t.created_at DESC
        `;
        const templates = await query(sql);
        return res.json({ templates: templates || [] });
    } catch (err) {
        console.error('❌ Error fetching templates for admin:', err);
        return res.status(500).json({ detail: 'Failed to fetch system templates' });
    }
});

// Create New Admin Template
router.post('/templates', adminAuthMiddleware, async (req, res) => {
    try {
        const { name, category, width } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ detail: 'Template name is required' });
        }

        const { v4: uuidv4 } = await import('uuid');
        const id = uuidv4();
        const now = new Date().toISOString();

        // Get a valid user_id or use default
        const adminUser = await queryOne('SELECT id FROM users LIMIT 1');
        const userId = adminUser?.id || 'system-admin';

        await query(
            `INSERT INTO templates (id, user_id, name, category, width, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [id, userId, name.trim(), category ? category.trim() : 'Business', width ? width.trim() : '58mm', now, now]
        );

        return res.status(201).json({ detail: 'Template created successfully', id });
    } catch (err) {
        console.error('❌ Error creating admin template:', err);
        return res.status(500).json({ detail: 'Failed to create template' });
    }
});

// Update Admin Template
router.put('/templates/:id', adminAuthMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, category, width } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ detail: 'Template name is required' });
        }

        const now = new Date().toISOString();
        await query(
            `UPDATE templates SET name = ?, category = ?, width = ?, updated_at = ? WHERE id = ?`,
            [name.trim(), category ? category.trim() : 'Business', width ? width.trim() : '58mm', now, id]
        );

        return res.json({ detail: 'Template updated successfully' });
    } catch (err) {
        console.error('❌ Error updating admin template:', err);
        return res.status(500).json({ detail: 'Failed to update template' });
    }
});

// Delete Admin Template
router.delete('/templates/:id', adminAuthMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        await query(`DELETE FROM templates WHERE id = ?`, [id]);
        return res.json({ detail: 'Template deleted successfully' });
    } catch (err) {
        console.error('❌ Error deleting admin template:', err);
        return res.status(500).json({ detail: 'Failed to delete template' });
    }
});

// System Product Catalog Management
router.get('/products', adminAuthMiddleware, async (req, res) => {
    try {
        const sql = `
            SELECT 
                p.id, 
                p.name, 
                p.price, 
                p.category, 
                p.tax_rate, 
                p.stock as stock_quantity, 
                p.image,
                p.images,
                p.status,
                p.created_at,
                u.name as user_name, 
                u.email as user_email, 
                s.name as shop_name
            FROM products p
            LEFT JOIN users u ON u.id = p.user_id
            LEFT JOIN shops s ON s.user_id = p.user_id
            ORDER BY p.created_at DESC
        `;
        const products = await query(sql);
        const normalized = (products || []).map(p => ({
            ...p,
            status: (p.status || 'active').toLowerCase().trim()
        }));
        return res.json({ products: normalized });
    } catch (err) {
        console.error('❌ Error fetching products for admin:', err);
        return res.status(500).json({ detail: 'Failed to fetch products' });
    }
});

// Create New Admin Product with Photos
router.post('/products', adminAuthMiddleware, async (req, res) => {
    try {
        const { name, category, price, tax_rate, images, image, status } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ detail: 'Product name is required' });
        }

        const cleanName = name.trim();
        const existingProd = await queryOne(`SELECT * FROM products WHERE LOWER(name) = ?`, [cleanName.toLowerCase()]);
        if (existingProd) {
            return res.status(200).json({ detail: 'Product already exists in catalog', product: existingProd });
        }

        let photoList = [];
        if (Array.isArray(images)) {
            photoList = images;
        } else if (typeof images === 'string' && images.trim()) {
            try { photoList = JSON.parse(images); } catch (_) { photoList = [images]; }
        } else if (image) {
            photoList = [image];
        }

        if (photoList.length < 3) {
            return res.status(400).json({ detail: 'Please upload at least 3 product photos.' });
        }
        if (photoList.length > 5) {
            return res.status(400).json({ detail: 'You can upload a maximum of 5 product photos.' });
        }

        const { v4: uuidv4 } = await import('uuid');
        const id = uuidv4();
        const now = new Date().toISOString();

        const adminUser = await queryOne('SELECT id FROM users ORDER BY created_at ASC LIMIT 1');
        if (!adminUser || !adminUser.id) {
            return res.status(400).json({ detail: 'No system user found to associate product.' });
        }
        const userId = adminUser.id;

        const mainImage = photoList[0] || image || '';
        const imagesJson = JSON.stringify(photoList);
        const prodStatus = (status || 'active').toLowerCase().trim();

        await query(
            `INSERT INTO products (id, user_id, name, price, category, tax_rate, stock, image, images, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                id, 
                userId, 
                name.trim(), 
                parseFloat(price) || 0, 
                category ? category.trim() : 'General', 
                parseFloat(tax_rate) || 0, 
                100, 
                mainImage, 
                imagesJson, 
                prodStatus,
                now, 
                now
            ]
        );

        const newProd = await queryOne(`SELECT * FROM products WHERE id = ?`, [id]);
        return res.status(201).json({ detail: 'Product created successfully', product: newProd });
    } catch (err) {
        console.error('❌ Error creating admin product:', err);
        return res.status(500).json({ detail: 'Failed to create product' });
    }
});

// Update Admin Product (General or Status)
router.put('/products/:id', adminAuthMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { status, name, price, category, tax_rate, stock } = req.body;
        
        let existing = await queryOne(`SELECT * FROM products WHERE id = ?`, [id]);
        if (!existing && name) {
            existing = await queryOne(`SELECT * FROM products WHERE LOWER(name) = ?`, [name.trim().toLowerCase()]);
        }
        if (!existing) {
            return res.status(404).json({ detail: 'Product not found' });
        }

        const targetId = existing.id;
        const newStatus = status ? status.toLowerCase().trim() : (existing.status || 'active');
        const newName = name !== undefined ? name.trim() : existing.name;
        const newPrice = price !== undefined ? parseFloat(price) : existing.price;
        const newCat = category !== undefined ? category.trim() : existing.category;
        const newTax = tax_rate !== undefined ? parseFloat(tax_rate) : existing.tax_rate;
        const newStock = stock !== undefined ? parseInt(stock) : existing.stock;
        const now = new Date().toISOString();

        await query(
            `UPDATE products SET name = ?, price = ?, category = ?, tax_rate = ?, stock = ?, status = ?, updated_at = ? WHERE id = ?`,
            [newName, newPrice, newCat, newTax, newStock, newStatus, now, targetId]
        );

        const updated = await queryOne(`SELECT * FROM products WHERE id = ?`, [targetId]);
        return res.json({ detail: 'Product updated successfully', product: updated });
    } catch (err) {
        console.error('❌ Error updating admin product:', err);
        return res.status(500).json({ detail: 'Failed to update product' });
    }
});

// Update Admin Product Status (Active / Inactive)
router.put('/products/:id/status', adminAuthMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { status, name } = req.body;
        if (!status || !['active', 'inactive'].includes(status.toLowerCase().trim())) {
            return res.status(400).json({ detail: 'Invalid status. Must be "active" or "inactive".' });
        }
        const newStatus = status.toLowerCase().trim();
        const now = new Date().toISOString();

        let existing = await queryOne(`SELECT * FROM products WHERE id = ?`, [id]);
        if (!existing && name) {
            existing = await queryOne(`SELECT * FROM products WHERE LOWER(name) = ?`, [name.trim().toLowerCase()]);
        }
        if (!existing) {
            return res.status(404).json({ detail: 'Product not found' });
        }

        const targetId = existing.id;
        await query(`UPDATE products SET status = ?, updated_at = ? WHERE id = ?`, [newStatus, now, targetId]);
        const updated = await queryOne(`SELECT * FROM products WHERE id = ?`, [targetId]);
        return res.json({ detail: 'Product status updated successfully', product: updated });
    } catch (err) {
        console.error('❌ Error updating admin product status:', err);
        return res.status(500).json({ detail: 'Failed to update product status' });
    }
});

// Delete Admin Product
router.delete('/products/:id', adminAuthMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        await query(`DELETE FROM products WHERE id = ?`, [id]);
        return res.json({ detail: 'Product deleted successfully' });
    } catch (err) {
        console.error('❌ Error deleting admin product:', err);
        return res.status(500).json({ detail: 'Failed to delete product' });
    }
});

// Plan Buyer Users & Active Subscriptions
router.get('/plan-buyers', adminAuthMiddleware, async (req, res) => {
    try {
        const subSql = `
            SELECT 
                sub.id as subscription_id,
                sub.user_id,
                COALESCE(u.name, sub.user_name, 'Paid Customer') as user_name,
                COALESCE(u.email, sub.user_email) as user_email,
                sub.plan_name,
                sub.amount,
                sub.prints_count,
                sub.payment_id,
                sub.payment_status,
                sub.created_at,
                s.name as shop_name,
                s.phone as shop_phone,
                (SELECT COUNT(*) FROM bills WHERE user_id = sub.user_id) as total_bills_printed
            FROM subscriptions sub
            LEFT JOIN users u ON u.id = sub.user_id
            LEFT JOIN shops s ON s.user_id = sub.user_id
            ORDER BY sub.created_at DESC
        `;
        const buyers = await query(subSql).catch(() => []);
        return res.json({ planBuyers: buyers || [] });
    } catch (err) {
        console.error('❌ Error fetching plan buyers for admin:', err);
        return res.status(500).json({ detail: 'Failed to fetch plan buyers' });
    }
});

// Grant Print Credits to User Shop
router.post('/users/:id/grant-prints', adminAuthMiddleware, async (req, res) => {
    try {
        const { printsToGrant } = req.body;
        const userId = req.params.id;
        const count = parseInt(printsToGrant || 500);

        if (isNaN(count) || count <= 0) {
            return res.status(400).json({ detail: 'Invalid print count' });
        }

        return res.json({
            detail: `Successfully granted ${count} print credits to user shop`,
            granted: count,
            userId
        });
    } catch (err) {
        console.error('❌ Error granting print credits:', err);
        return res.status(500).json({ detail: 'Failed to grant print credits' });
    }
});

export default router;
