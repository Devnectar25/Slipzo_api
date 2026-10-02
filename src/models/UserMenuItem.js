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
        this.barcode = data.barcode || '';
        this.barcode_type = data.barcode_type || 'INTERNAL';
        this.barcode_active = data.barcode_active !== undefined ? Boolean(data.barcode_active) : true;
        this.is_available = data.is_available !== undefined ? Boolean(data.is_available) : true;
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
                COALESCE(umi.barcode_active, true) as barcode_active,
                umi.created_at,
                umi.updated_at,
                COALESCE(sb.name, mi.name, cg.name, hf.name, '') as name,
                COALESCE(sb.category, mi.category, cg.category, hf.category, 'General') as category,
                COALESCE(sb.image_url, mi.image_url, cg.image_url, hf.image_url, '') as image_url,
                COALESCE(sb.description, mi.description, cg.description, hf.description, '') as description,
                COALESCE(sb.barcode, mi.barcode, cg.barcode, hf.barcode, '') as barcode,
                COALESCE(sb.barcode_type, mi.barcode_type, cg.barcode_type, hf.barcode_type, 'INTERNAL') as barcode_type,
                COALESCE(sb.is_available, mi.is_available, cg.is_available, hf.is_available, true) as is_available,
                COALESCE(sb.price, mi.price, cg.price, hf.price, 0) as catalog_price
            FROM user_menu_items umi
            LEFT JOIN small_business sb ON umi.menu_item_id = sb.id
            LEFT JOIN menu_items mi ON umi.menu_item_id = mi.id
            LEFT JOIN clothing_garments cg ON umi.menu_item_id = cg.id
            LEFT JOIN hotel_food hf ON umi.menu_item_id = hf.id
            WHERE umi.user_id = ?
        `;
        const params = [userId];

        if (search && search.trim()) {
            sql += ` AND (
                LOWER(COALESCE(sb.name, mi.name, cg.name, hf.name, '')) LIKE LOWER(?) OR 
                LOWER(COALESCE(sb.barcode, mi.barcode, cg.barcode, hf.barcode, '')) LIKE LOWER(?) OR 
                LOWER(COALESCE(sb.category, mi.category, cg.category, hf.category, '')) LIKE LOWER(?)
            )`;
            params.push(`%${search.trim()}%`, `%${search.trim()}%`, `%${search.trim()}%`);
        }

        if (category && category !== 'all' && category !== 'All') {
            sql += ` AND LOWER(COALESCE(sb.category, mi.category, cg.category, hf.category, 'General')) = LOWER(?)`;
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
                COALESCE(umi.barcode_active, true) as barcode_active,
                umi.created_at,
                umi.updated_at,
                COALESCE(sb.name, mi.name, cg.name, hf.name, '') as name,
                COALESCE(sb.category, mi.category, cg.category, hf.category, 'General') as category,
                COALESCE(sb.image_url, mi.image_url, cg.image_url, hf.image_url, '') as image_url,
                COALESCE(sb.description, mi.description, cg.description, hf.description, '') as description,
                COALESCE(sb.barcode, mi.barcode, cg.barcode, hf.barcode, '') as barcode,
                COALESCE(sb.barcode_type, mi.barcode_type, cg.barcode_type, hf.barcode_type, 'INTERNAL') as barcode_type,
                COALESCE(sb.is_available, mi.is_available, cg.is_available, hf.is_available, true) as is_available,
                COALESCE(sb.price, mi.price, cg.price, hf.price, 0) as catalog_price
            FROM user_menu_items umi
            LEFT JOIN small_business sb ON umi.menu_item_id = sb.id
            LEFT JOIN menu_items mi ON umi.menu_item_id = mi.id
            LEFT JOIN clothing_garments cg ON umi.menu_item_id = cg.id
            LEFT JOIN hotel_food hf ON umi.menu_item_id = hf.id
            WHERE umi.id = ? AND umi.user_id = ?
        `;
        const data = await queryOne(sql, [id, userId]);
        return data ? new UserMenuItem(data) : null;
    }

    static async findByBarcodeAndUser(userId, barcode) {
        if (!barcode || !String(barcode).trim()) return null;
        const clean = String(barcode).trim();
        const sql = `
            SELECT 
                umi.id,
                umi.user_id,
                umi.menu_item_id,
                umi.custom_price,
                umi.custom_price as price,
                umi.is_active,
                COALESCE(umi.barcode_active, true) as barcode_active,
                umi.created_at,
                umi.updated_at,
                COALESCE(sb.name, mi.name, cg.name, hf.name, '') as name,
                COALESCE(sb.category, mi.category, cg.category, hf.category, 'General') as category,
                COALESCE(sb.image_url, mi.image_url, cg.image_url, hf.image_url, '') as image_url,
                COALESCE(sb.description, mi.description, cg.description, hf.description, '') as description,
                COALESCE(sb.barcode, mi.barcode, cg.barcode, hf.barcode, '') as barcode,
                COALESCE(sb.barcode_type, mi.barcode_type, cg.barcode_type, hf.barcode_type, 'INTERNAL') as barcode_type,
                COALESCE(sb.is_available, mi.is_available, cg.is_available, hf.is_available, true) as is_available,
                COALESCE(sb.price, mi.price, cg.price, hf.price, 0) as catalog_price
            FROM user_menu_items umi
            LEFT JOIN small_business sb ON umi.menu_item_id = sb.id
            LEFT JOIN menu_items mi ON umi.menu_item_id = mi.id
            LEFT JOIN clothing_garments cg ON umi.menu_item_id = cg.id
            LEFT JOIN hotel_food hf ON umi.menu_item_id = hf.id
            WHERE umi.user_id = ? 
              AND (LOWER(COALESCE(sb.barcode, mi.barcode, cg.barcode, hf.barcode, '')) = LOWER(?))
              AND (umi.barcode_active IS NOT FALSE)
        `;
        const data = await queryOne(sql, [userId, clean]);
        return data ? new UserMenuItem(data) : null;
    }

    static async findByUserAndMenuItem(userId, menuItemId) {
        const sql = `SELECT * FROM user_menu_items WHERE user_id = ? AND menu_item_id = ?`;
        const data = await queryOne(sql, [userId, menuItemId]);
        return data || null;
    }

    static async create(userId, menuItemId, customPrice, barcodeActive = true) {
        const isBActive = barcodeActive !== false;
        const existing = await UserMenuItem.findByUserAndMenuItem(userId, menuItemId);
        if (existing) {
            const numPrice = Math.max(0, parseFloat(customPrice) || 0);
            await update(
                'user_menu_items',
                { custom_price: numPrice, is_active: true, barcode_active: isBActive, updated_at: new Date().toISOString() },
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
            barcode_active: isBActive,
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
        if (updates.barcode_active !== undefined) {
            updateFields.barcode_active = Boolean(updates.barcode_active);
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

    static async deleteAllByUserId(userId) {
        const result = await query(
            'DELETE FROM user_menu_items WHERE user_id = ?',
            [userId]
        );
        const affected = result ? (result.affectedRows || result.changes || 0) : 0;
        return affected;
    }
}

