import { v4 as uuidv4 } from 'uuid';
import { query, queryOne, insert, update } from '../config/database.js';

export default class UserMenuItem {
    constructor(data) {
        this.id = data.id;
        this.user_id = data.user_id;
        this.menu_item_id = data.menu_item_id;
        this.price = Number(data.price || data.custom_price || 0);
        this.custom_price = Number(data.custom_price || data.price || 0);
        this.catalog_price = Number(data.catalog_price || 0);
        this.name = data.name || '';
        this.category = data.category || 'General';
        this.image_url = data.image_url || '';
        this.description = data.description || '';
        this.is_active = data.is_active !== undefined ? Boolean(data.is_active) : true;
        this.created_at = data.created_at;
        this.updated_at = data.updated_at;
    }

    static async findByUserId(userId, search = '', category = 'all') {
        let sql = `
            SELECT 
                umi.id,
                umi.user_id,
                umi.menu_item_id,
                umi.custom_price,
                umi.custom_price as price,
                umi.is_active,
                umi.created_at,
                umi.updated_at,
                mi.name,
                mi.category,
                mi.image_url,
                mi.description,
                mi.price as catalog_price
            FROM user_menu_items umi
            JOIN menu_items mi ON umi.menu_item_id = mi.id
            WHERE umi.user_id = ?
        `;
        const params = [userId];

        if (search && search.trim()) {
            sql += ` AND LOWER(mi.name) LIKE LOWER(?)`;
            params.push(`%${search.trim()}%`);
        }

        if (category && category !== 'all' && category !== 'All') {
            sql += ` AND LOWER(mi.category) = LOWER(?)`;
            params.push(category.trim());
        }

        sql += ` ORDER BY umi.created_at DESC`;

        const rows = await query(sql, params);
        return (rows || []).map(r => new UserMenuItem(r));
    }

    static async findByIdAndUser(id, userId) {
        const sql = `
            SELECT 
                umi.id,
                umi.user_id,
                umi.menu_item_id,
                umi.custom_price,
                umi.custom_price as price,
                umi.is_active,
                umi.created_at,
                umi.updated_at,
                mi.name,
                mi.category,
                mi.image_url,
                mi.description,
                mi.price as catalog_price
            FROM user_menu_items umi
            JOIN menu_items mi ON umi.menu_item_id = mi.id
            WHERE umi.id = ? AND umi.user_id = ?
        `;
        const data = await queryOne(sql, [id, userId]);
        return data ? new UserMenuItem(data) : null;
    }

    static async findByUserAndMenuItem(userId, menuItemId) {
        const sql = `SELECT * FROM user_menu_items WHERE user_id = ? AND menu_item_id = ?`;
        const data = await queryOne(sql, [userId, menuItemId]);
        return data || null;
    }

    static async create(userId, menuItemId, customPrice) {
        const existing = await UserMenuItem.findByUserAndMenuItem(userId, menuItemId);
        if (existing) {
            // If already added, update the price
            const numPrice = Math.max(0, parseFloat(customPrice) || 0);
            await update(
                'user_menu_items',
                { custom_price: numPrice, is_active: true, updated_at: new Date().toISOString() },
                'id = ? AND user_id = ?',
                [existing.id, userId]
            );
            return await UserMenuItem.findByIdAndUser(existing.id, userId);
        }

        const id = uuidv4();
        const numPrice = Math.max(0, parseFloat(customPrice) || 0);
        const now = new Date().toISOString();

        const newItem = {
            id,
            user_id: userId,
            menu_item_id: menuItemId,
            custom_price: numPrice,
            is_active: true,
            created_at: now,
            updated_at: now
        };

        await insert('user_menu_items', newItem);
        return await UserMenuItem.findByIdAndUser(id, userId);
    }

    static async update(id, userId, updates) {
        const existing = await UserMenuItem.findByIdAndUser(id, userId);
        if (!existing) return null;

        const updateFields = {};
        if (updates.price !== undefined || updates.custom_price !== undefined) {
            const rawPrice = updates.custom_price !== undefined ? updates.custom_price : updates.price;
            updateFields.custom_price = Math.max(0, parseFloat(rawPrice) || 0);
        }
        if (updates.is_active !== undefined) {
            updateFields.is_active = Boolean(updates.is_active);
        }
        updateFields.updated_at = new Date().toISOString();

        await update('user_menu_items', updateFields, 'id = ? AND user_id = ?', [id, userId]);
        return await UserMenuItem.findByIdAndUser(id, userId);
    }

    static async delete(id, userId) {
        const result = await query(
            'DELETE FROM user_menu_items WHERE id = ? AND user_id = ?',
            [id, userId]
        );
        const affected = result ? (result.affectedRows || result.changes || 0) : 0;
        return affected > 0;
    }
}
