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
    static async seedDefaultProducts(userId) {
        try {
            for (const item of DEFAULT_HARDWARE_PRODUCTS) {
                await this.create({
                    user_id: userId,
                    ...item
                });
            }
        } catch (e) {
            console.warn("⚠️ Failed to seed default products:", e.message);
        }
    }

    static async findByUserId(userId, search = '', category = '') {
        let sql = `SELECT * FROM products WHERE user_id = ?`;
        const params = [userId];

        if (category && category !== 'all' && category !== 'All') {
            sql += ` AND category = ?`;
            params.push(category);
        }

        if (search && search.trim()) {
            sql += ` AND (name LIKE ? OR category LIKE ? OR sku LIKE ?)`;
            const searchParam = `%${search.trim()}%`;
            params.push(searchParam, searchParam, searchParam);
        }

        sql += ` ORDER BY created_at DESC`;
        let results = await query(sql, params);

        // If user has no products yet and no filters applied, seed initial database records
        if ((!results || results.length === 0) && !search && (!category || category === 'all' || category === 'All')) {
            await this.seedDefaultProducts(userId);
            results = await query(sql, params);
        }

        return results || [];
    }

    static async findByIdAndUser(id, userId) {
        return await queryOne(`SELECT * FROM products WHERE id = ? AND user_id = ?`, [id, userId]);
    }

    static async create(data) {
        const id = uuidv4();
        const { user_id, name, price = 0, category = 'General', sku = '', tax_rate = 0, stock = 100, image = '', description = '' } = data;
        const now = new Date().toISOString();

        await query(
            `INSERT INTO products (id, user_id, name, price, category, sku, tax_rate, stock, image, description, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, user_id, name.trim(), parseFloat(price) || 0, category.trim() || 'General', sku ? sku.trim() : null, parseFloat(tax_rate) || 0, parseInt(stock) || 100, image ? image.trim() : '', description ? description.trim() : '', now, now]
        );

        return await this.findByIdAndUser(id, user_id);
    }

    static async update(id, userId, data) {
        const product = await this.findByIdAndUser(id, userId);
        if (!product) return null;

        const name = data.name !== undefined ? data.name.trim() : product.name;
        const price = data.price !== undefined ? parseFloat(data.price) : product.price;
        const category = data.category !== undefined ? data.category.trim() : product.category;
        const sku = data.sku !== undefined ? (data.sku ? data.sku.trim() : null) : product.sku;
        const tax_rate = data.tax_rate !== undefined ? parseFloat(data.tax_rate) : product.tax_rate;
        const stock = data.stock !== undefined ? parseInt(data.stock) : product.stock;
        const image = data.image !== undefined ? (data.image ? data.image.trim() : '') : (product.image || '');
        const description = data.description !== undefined ? data.description.trim() : product.description;
        const now = new Date().toISOString();

        await query(
            `UPDATE products 
             SET name = ?, price = ?, category = ?, sku = ?, tax_rate = ?, stock = ?, image = ?, description = ?, updated_at = ?
             WHERE id = ? AND user_id = ?`,
            [name, price, category, sku, tax_rate, stock, image, description, now, id, userId]
        );

        return await this.findByIdAndUser(id, userId);
    }

    static async delete(id, userId) {
        const result = await query(`DELETE FROM products WHERE id = ? AND user_id = ?`, [id, userId]);
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
