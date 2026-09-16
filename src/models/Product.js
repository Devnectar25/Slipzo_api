import { query, queryOne } from '../config/database.js';
import { v4 as uuidv4 } from 'uuid';

const DEFAULT_HARDWARE_PRODUCTS = [
    { 
        name: "NIYAMA Portable Bluetooth POS Printer (58mm)", 
        price: 2699, 
        category: "Hardware", 
        sku: "NIYAMA-58BT", 
        tax_rate: 18, 
        stock: 18, 
        image: "/products/niyama_printer.jpg",
        description: "Rechargeable 58mm Bluetooth handheld mobile thermal printer with battery indicator and high-speed receipt printing" 
    },
    { 
        name: "Hansol SUPERMAX Thermal POS Paper Rolls (Pack of 10)", 
        price: 420, 
        category: "Hardware", 
        sku: "HANSOL-SMAX-10", 
        tax_rate: 18, 
        stock: 95, 
        image: "/products/hansol_rolls.jpg",
        description: "Premium grade Hansol SUPERMAX smooth, jam-free thermal receipt rolls for clear dark printing" 
    },
    { 
        name: "Bluetooth POS Receipt Printer (80mm)", 
        price: 2850, 
        category: "Hardware", 
        sku: "POS-BT200", 
        tax_rate: 18, 
        stock: 12, 
        image: "/products/pos_printer.jpg",
        description: "Portable 58mm wireless thermal printer for Android & iOS with rechargeable battery" 
    },
    { 
        name: "80mm POS Thermal Paper Rolls (10 Rolls)", 
        price: 450, 
        category: "Hardware", 
        sku: "ROLL-80MM-10", 
        tax_rate: 18, 
        stock: 85, 
        image: "/products/paper_rolls.jpg",
        description: "ATPOS premium smooth thermal paper rolls, jam-free dark printing for POS terminals" 
    }
];

class Product {
    static async seedDefaultProducts(adminUserId = 'system-catalog') {
        // Disabled: Database stores ONLY products created by Admin panel
        return;
    }

    static async findByUserId(userId, search = '', category = '', activeOnly = false) {
        let sql = `SELECT * FROM products WHERE 1=1`;
        const params = [];

        if (activeOnly) {
            sql += ` AND (status IS NULL OR LOWER(status) = 'active' OR status = '')`;
        }

        if (category && category !== 'all' && category !== 'All') {
            sql += ` AND category = ?`;
            params.push(category);
        }

        if (search && search.trim()) {
            sql += ` AND (LOWER(name) LIKE ? OR LOWER(category) LIKE ? OR LOWER(sku) LIKE ?)`;
            const searchParam = `%${search.trim().toLowerCase()}%`;
            params.push(searchParam, searchParam, searchParam);
        }

        sql += ` ORDER BY created_at DESC`;
        let results = await query(sql, params);
        return results || [];
    }

    static async findByIdAndUser(id, userId) {
        return await queryOne(`SELECT * FROM products WHERE id = ?`, [id]);
    }

    static async create(data) {
        const { user_id, name, price = 0, category = 'General', sku = '', tax_rate = 0, stock = 100, image = '', images = '', description = '', status = 'active' } = data;
        const cleanName = name ? name.trim() : '';
        const cleanSku = sku ? sku.trim() : '';

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
            `INSERT INTO products (id, user_id, name, price, category, sku, tax_rate, stock, image, images, description, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, user_id, cleanName, parseFloat(price) || 0, category.trim() || 'General', cleanSku || null, parseFloat(tax_rate) || 0, parseInt(stock) || 100, image ? image.trim() : '', imagesStr, description ? description.trim() : '', statusStr, now, now]
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
        const tax_rate = data.tax_rate !== undefined ? parseFloat(data.tax_rate) : product.tax_rate;
        const stock = data.stock !== undefined ? parseInt(data.stock) : product.stock;
        const image = data.image !== undefined ? (data.image ? data.image.trim() : '') : (product.image || '');
        const images = data.images !== undefined ? (typeof data.images === 'string' ? data.images : JSON.stringify(data.images)) : (product.images || '');
        const description = data.description !== undefined ? data.description.trim() : product.description;
        const status = data.status !== undefined ? data.status.trim().toLowerCase() : (product.status || 'active');
        const now = new Date().toISOString();

        await query(
            `UPDATE products 
             SET name = ?, price = ?, category = ?, sku = ?, tax_rate = ?, stock = ?, image = ?, images = ?, description = ?, status = ?, updated_at = ?
             WHERE id = ?`,
            [name, price, category, sku, tax_rate, stock, image, images, description, status, now, id]
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
