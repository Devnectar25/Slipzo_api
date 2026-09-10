import { query, queryOne } from '../config/database.js';
import { v4 as uuidv4 } from 'uuid';

class Product {
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

        sql += ` ORDER BY name ASC`;
        return await query(sql, params);
    }

    static async findByIdAndUser(id, userId) {
        return await queryOne(`SELECT * FROM products WHERE id = ? AND user_id = ?`, [id, userId]);
    }

    static async create(data) {
        const id = uuidv4();
        const { user_id, name, price = 0, category = 'General', sku = '', tax_rate = 0, stock = 100, description = '' } = data;
        const now = new Date().toISOString();

        await query(
            `INSERT INTO products (id, user_id, name, price, category, sku, tax_rate, stock, description, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, user_id, name.trim(), parseFloat(price) || 0, category.trim() || 'General', sku ? sku.trim() : null, parseFloat(tax_rate) || 0, parseInt(stock) || 100, description ? description.trim() : '', now, now]
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
        const description = data.description !== undefined ? data.description.trim() : product.description;
        const now = new Date().toISOString();

        await query(
            `UPDATE products 
             SET name = ?, price = ?, category = ?, sku = ?, tax_rate = ?, stock = ?, description = ?, updated_at = ?
             WHERE id = ? AND user_id = ?`,
            [name, price, category, sku, tax_rate, stock, description, now, id, userId]
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
