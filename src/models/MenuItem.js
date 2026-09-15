import { v4 as uuidv4 } from 'uuid';
import { query, queryOne, insert, update } from '../config/database.js';

export default class MenuItem {
    constructor(data) {
        this.id = data.id || uuidv4();
        this.user_id = data.user_id;
        this.name = data.name;
        this.price = Number(data.price || 0);
        this.created_at = data.created_at;
        this.updated_at = data.updated_at;
    }

    static async findByUserId(userId, search = '') {
        let sql = `SELECT * FROM menu_items WHERE user_id = ?`;
        const params = [userId];

        if (search && search.trim()) {
            sql += ` AND name LIKE ?`;
            params.push(`%${search.trim()}%`);
        }

        sql += ` ORDER BY created_at DESC`;

        const rows = await query(sql, params);
        return (rows || []).map(r => new MenuItem(r));
    }

    static async findByIdAndUser(id, userId) {
        const sql = `SELECT * FROM menu_items WHERE id = ? AND user_id = ?`;
        const data = await queryOne(sql, [id, userId]);
        return data ? new MenuItem(data) : null;
    }

    static async findByNameAndUser(name, userId) {
        if (!name || !name.trim()) return null;
        const sql = `SELECT * FROM menu_items WHERE LOWER(name) = LOWER(?) AND user_id = ?`;
        const data = await queryOne(sql, [name.trim(), userId]);
        return data ? new MenuItem(data) : null;
    }

    static async create(itemData) {
        const name = itemData.name.trim();
        const price = Math.max(0, parseFloat(itemData.price) || 0);
        const userId = itemData.user_id;

        // Check if item with exact name already exists for user
        const existing = await MenuItem.findByNameAndUser(name, userId);
        if (existing) {
            // Update price of existing item instead of creating duplicate record
            return await MenuItem.update(existing.id, userId, { price });
        }

        const item = {
            id: uuidv4(),
            user_id: userId,
            name: name,
            price: price
        };

        await insert('menu_items', item);
        return await MenuItem.findByIdAndUser(item.id, userId);
    }

    static async update(id, userId, updates) {
        const item = await MenuItem.findByIdAndUser(id, userId);
        if (!item) return null;

        const updatedData = {};
        if (updates.name !== undefined && updates.name.trim()) {
            updatedData.name = updates.name.trim();
        }
        if (updates.price !== undefined) {
            updatedData.price = Math.max(0, parseFloat(updates.price) || 0);
        }

        if (Object.keys(updatedData).length === 0) {
            return item;
        }

        await update('menu_items', updatedData, 'id = ? AND user_id = ?', [id, userId]);
        return await MenuItem.findByIdAndUser(id, userId);
    }

    static async delete(id, userId) {
        const result = await query(
            'DELETE FROM menu_items WHERE id = ? AND user_id = ?',
            [id, userId]
        );
        const affected = result ? (result.affectedRows || result.changes || 0) : 0;
        return affected > 0;
    }
}
