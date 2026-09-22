import { query, queryOne } from '../config/database.js';
import { v4 as uuidv4 } from 'uuid';

const DEFAULT_HARDWARE_PRODUCTS = [
    { 
        name: "NIYAMA Portable Bluetooth POS Printer (58mm)", 
        price: 2699, 
        category: "Hardware", 
        sku: "NIYAMA-58BT", 
        product_link: "https://slipzo.in/products", 
        stock: 18, 
        image: "/products/niyama_printer.jpg",
        description: "Rechargeable 58mm Bluetooth handheld mobile thermal printer with battery indicator and high-speed receipt printing" 
    },
    { 
        name: "Hansol SUPERMAX Thermal POS Paper Rolls (Pack of 10)", 
        price: 420, 
        category: "Hardware", 
        sku: "HANSOL-SMAX-10", 
        product_link: "https://slipzo.in/products", 
        stock: 95, 
        image: "/products/hansol_rolls.jpg",
        description: "Premium grade Hansol SUPERMAX smooth, jam-free thermal receipt rolls for clear dark printing" 
    },
    { 
        name: "Bluetooth POS Receipt Printer (80mm)", 
        price: 2850, 
        category: "Hardware", 
        sku: "POS-BT200", 
        product_link: "https://slipzo.in/products", 
        stock: 12, 
        image: "/products/pos_printer.jpg",
        description: "Portable 58mm wireless thermal printer for Android & iOS with rechargeable battery" 
    },
    { 
        name: "80mm POS Thermal Paper Rolls (10 Rolls)", 
        price: 450, 
        category: "Hardware", 
        sku: "ROLL-80MM-10", 
        product_link: "https://slipzo.in/products", 
        stock: 85, 
        image: "/products/paper_rolls.jpg",
        description: "ATPOS premium smooth thermal paper rolls, jam-free dark printing for POS terminals" 
    }
];

class Product {
    static async seedDefaultProducts(adminUserId = 'system-catalog') {
        try {
            const countResult = await queryOne(`SELECT COUNT(*) as count FROM products`);
            const total = parseInt(countResult?.count || 0);
            if (total > 0) return;

            // Attempt to fetch from Supabase if connected
            let supabaseProducts = null;
            try {
                const { supabase } = await import('../config/database.js');
                if (supabase) {
                    const { data, error } = await supabase.from('products').select('*');
                    if (!error && Array.isArray(data) && data.length > 0) {
                        supabaseProducts = data;
                    }
                }
            } catch (_) {}

            if (supabaseProducts && supabaseProducts.length > 0) {
                console.log(`📦 Syncing ${supabaseProducts.length} products from Supabase to database...`);
                for (const item of supabaseProducts) {
                    await this.create({
                        user_id: item.user_id || adminUserId,
                        name: item.name,
                        price: item.price,
                        category: item.category || 'Hardware',
                        sku: item.sku || '',
                        product_link: item.product_link || '',
                        stock: item.stock || 100,
                        image: item.image || '',
                        images: item.images || '',
                        description: item.description || '',
                        status: item.status || 'active'
                    });
                }
                return;
            }

            console.log(`📦 Seeding default hardware products into database...`);
            for (const item of DEFAULT_HARDWARE_PRODUCTS) {
                await this.create({
                    user_id: adminUserId,
                    ...item
                });
            }
        } catch (e) {
            console.warn("⚠️ Failed to seed default products:", e.message);
        }
    }

    static async findByUserId(userId, search = '', category = '', activeOnly = false) {
        let sql = `SELECT * FROM products WHERE 1=1`;
        const params = [];

        if (activeOnly) {
            sql += ` AND (status IS NULL OR LOWER(status) = 'active' OR status = '')`;
        }

        if (category && category !== 'all' && category !== 'All') {
            sql += ` AND LOWER(category) = LOWER(?)`;
            params.push(category);
        }

        if (search && search.trim()) {
            sql += ` AND (LOWER(name) LIKE ? OR LOWER(category) LIKE ? OR LOWER(sku) LIKE ?)`;
            const searchParam = `%${search.trim().toLowerCase()}%`;
            params.push(searchParam, searchParam, searchParam);
        }

        sql += ` ORDER BY created_at DESC`;
        let results = await query(sql, params);

        // If no products exist yet and no filters applied, seed default products and re-query
        if ((!results || results.length === 0) && !search && (!category || category === 'all' || category === 'All')) {
            await this.seedDefaultProducts(userId || 'system-catalog');
            results = await query(sql, params);
        }

        return results || [];
    }

    static async findByIdAndUser(id, userId) {
        return await queryOne(`SELECT * FROM products WHERE id = ?`, [id]);
    }

    static async create(data) {
        const { user_id, name, price = 0, category = 'General', sku = '', product_link = '', stock = 100, image = '', images = '', description = '', status = 'active' } = data;
        const cleanName = name ? name.trim() : '';
        const cleanSku = sku ? sku.trim() : '';
        const cleanLink = product_link ? product_link.trim() : '';

        // Duplicate prevention check: return existing record if product with exact SKU or Name already exists
        if (cleanSku) {
            const existingSku = await queryOne(`SELECT * FROM products WHERE sku = ?`, [cleanSku]);
            if (existingSku) return existingSku;
        }
        if (cleanName) {
            const existingName = await queryOne(`SELECT * FROM products WHERE LOWER(name) = ?`, [cleanName.toLowerCase()]);
            if (existingName) return existingName;
        }

        const id = uuidv4();
        const now = new Date().toISOString();
        const imagesStr = typeof images === 'string' ? images : JSON.stringify(images || []);
        const statusStr = (status || 'active').toLowerCase().trim();

        await query(
            `INSERT INTO products (id, user_id, name, price, category, sku, product_link, stock, image, images, description, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, user_id, cleanName, parseFloat(price) || 0, category.trim() || 'General', cleanSku || null, cleanLink, parseInt(stock) || 100, image ? image.trim() : '', imagesStr, description ? description.trim() : '', statusStr, now, now]
        );

        return await queryOne(`SELECT * FROM products WHERE id = ?`, [id]);
    }

    static async update(id, userId, data) {
        const product = await queryOne(`SELECT * FROM products WHERE id = ?`, [id]);
        if (!product) return null;

        const name = data.name !== undefined ? data.name.trim() : product.name;
        const price = data.price !== undefined ? parseFloat(data.price) : product.price;
        const category = data.category !== undefined ? data.category.trim() : product.category;
        const sku = data.sku !== undefined ? (data.sku ? data.sku.trim() : null) : product.sku;
        const product_link = data.product_link !== undefined ? (data.product_link ? data.product_link.trim() : '') : (product.product_link || '');
        const stock = data.stock !== undefined ? parseInt(data.stock) : product.stock;
        const image = data.image !== undefined ? (data.image ? data.image.trim() : '') : (product.image || '');
        const images = data.images !== undefined ? (typeof data.images === 'string' ? data.images : JSON.stringify(data.images)) : (product.images || '');
        const description = data.description !== undefined ? data.description.trim() : product.description;
        const status = data.status !== undefined ? data.status.trim().toLowerCase() : (product.status || 'active');
        const now = new Date().toISOString();

        await query(
            `UPDATE products 
             SET name = ?, price = ?, category = ?, sku = ?, product_link = ?, stock = ?, image = ?, images = ?, description = ?, status = ?, updated_at = ?
             WHERE id = ?`,
            [name, price, category, sku, product_link, stock, image, images, description, status, now, id]
        );

        return await queryOne(`SELECT * FROM products WHERE id = ?`, [id]);
    }

    static async delete(id, userId) {
        const result = await query(`DELETE FROM products WHERE id = ?`, [id]);
        return (result?.affectedRows || result?.changes || 0) > 0;
    }

    static async getStats(userId) {
        const total = await queryOne(`SELECT COUNT(*) as count FROM products WHERE user_id = ?`, [userId]);
        const categories = await queryOne(`SELECT COUNT(DISTINCT category) as count FROM products WHERE user_id = ?`, [userId]);
        const lowStock = await queryOne(`SELECT COUNT(*) as count FROM products WHERE user_id = ? AND stock < 10`, [userId]);

        return {
            totalProducts: parseInt(total?.count || 0),
            totalCategories: parseInt(categories?.count || 0),
            lowStockProducts: parseInt(lowStock?.count || 0)
        };
    }
}

export default Product;
