import { v4 as uuidv4 } from 'uuid';
import { query, queryOne, insert, update } from '../config/database.js';

export default class MenuItem {
    constructor(data) {
        this.id = data.id || uuidv4();
        this.user_id = data.user_id;
        this.name = data.name;
        this.price = Number(data.price || 0);
        this.category = data.category || 'General';
        this.image_url = data.image_url || '';
        this.description = data.description || '';
        this.is_available = data.is_available !== undefined ? Boolean(data.is_available) : true;
        this.created_at = data.created_at;
        this.updated_at = data.updated_at;
        // Optional user assignment metadata when queried via catalog
        this.is_added = data.is_added !== undefined ? Boolean(data.is_added) : false;
        this.user_menu_item_id = data.user_menu_item_id || null;
        this.user_price = data.user_price !== undefined && data.user_price !== null ? Number(data.user_price) : null;
    }

    /**
     * Fetch the Available Master Catalog for a specific user
     * Marks items as `is_added: true` if already in the user's personal menu
     */
    static async findCatalogForUser(userId, search = '', category = 'all') {
        let sql = `
            SELECT 
                mi.id,
                mi.name,
                mi.price,
                mi.category,
                mi.image_url,
                mi.description,
                mi.is_available,
                mi.created_at,
                mi.updated_at,
                umi.id as user_menu_item_id,
                umi.custom_price as user_price,
                CASE WHEN umi.id IS NOT NULL THEN true ELSE false END as is_added
            FROM menu_items mi
            LEFT JOIN user_menu_items umi 
                ON mi.id = umi.menu_item_id AND umi.user_id = ?
            WHERE (mi.is_available IS NOT FALSE)
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

        sql += ` ORDER BY mi.name ASC`;

        const rows = await query(sql, params);
        return (rows || []).map(r => new MenuItem(r));
    }

    /**
     * Admin view: Fetch all master menu items (including inactive)
     */
    static async findAllAdmin({ search = '', category = 'all', page = 1, limit = 100 } = {}) {
        let whereClause = ` WHERE 1=1`;
        const params = [];

        if (search && search.trim()) {
            whereClause += ` AND (LOWER(name) LIKE LOWER(?) OR LOWER(category) LIKE LOWER(?))`;
            params.push(`%${search.trim()}%`, `%${search.trim()}%`);
        }

        if (category && category !== 'all' && category !== 'All') {
            whereClause += ` AND LOWER(category) = LOWER(?)`;
            params.push(category.trim());
        }

        const countSql = `SELECT COUNT(*) as total FROM menu_items` + whereClause;
        const countRes = await queryOne(countSql, params);
        const total = countRes ? (countRes.total || countRes.count || 0) : 0;

        const offset = Math.max(0, (page - 1) * limit);
        const dataSql = `SELECT * FROM menu_items` + whereClause + ` ORDER BY created_at DESC LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}`;
        const rows = await query(dataSql, params);

        return {
            items: (rows || []).map(r => new MenuItem(r)),
            total: Number(total),
            page: Number(page),
            limit: Number(limit),
            totalPages: Math.ceil(total / limit) || 1
        };
    }

    static async findById(id) {
        const sql = `SELECT * FROM menu_items WHERE id = ?`;
        const data = await queryOne(sql, [id]);
        return data ? new MenuItem(data) : null;
    }

    static async createMaster(itemData) {
        const name = (itemData.name || '').trim();
        const price = Math.max(0, parseFloat(itemData.price) || 0);
        const category = (itemData.category || 'General').trim();
        const imageUrl = itemData.image_url || '';
        const description = (itemData.description || '').trim();
        const isAvailable = itemData.is_available !== undefined ? Boolean(itemData.is_available) : true;
        const now = new Date().toISOString();

        const newItem = {
            id: uuidv4(),
            user_id: null,
            name,
            price,
            category,
            image_url: imageUrl,
            description,
            is_available: isAvailable,
            created_at: now,
            updated_at: now
        };

        await insert('menu_items', newItem);
        return await MenuItem.findById(newItem.id);
    }

    static async updateMaster(id, updates) {
        const existing = await MenuItem.findById(id);
        if (!existing) return null;

        const updatedData = {};
        if (updates.name !== undefined && updates.name.trim()) {
            updatedData.name = updates.name.trim();
        }
        if (updates.price !== undefined) {
            updatedData.price = Math.max(0, parseFloat(updates.price) || 0);
        }
        if (updates.category !== undefined) {
            updatedData.category = updates.category.trim() || 'General';
        }
        if (updates.image_url !== undefined) {
            updatedData.image_url = updates.image_url;
        }
        if (updates.description !== undefined) {
            updatedData.description = updates.description.trim();
        }
        if (updates.is_available !== undefined) {
            updatedData.is_available = Boolean(updates.is_available);
        }
        updatedData.updated_at = new Date().toISOString();

        if (Object.keys(updatedData).length === 0) {
            return existing;
        }

        await update('menu_items', updatedData, 'id = ?', [id]);
        return await MenuItem.findById(id);
    }

    static async deleteMaster(id) {
        // Safe check: If any user has this in user_menu_items, soft-deactivate instead of hard deleting
        const refCheck = await queryOne('SELECT count(*) as cnt FROM user_menu_items WHERE menu_item_id = ?', [id]);
        const refCount = refCheck ? (refCheck.cnt || refCheck.count || 0) : 0;

        if (Number(refCount) > 0) {
            // Soft delete / inactivate to preserve user menus
            await update('menu_items', { is_available: false, updated_at: new Date().toISOString() }, 'id = ?', [id]);
            return { deleted: true, softDeleted: true, message: 'Item is assigned in user menus; marked inactive to protect user menus.' };
        }

        const result = await query('DELETE FROM menu_items WHERE id = ?', [id]);
        const affected = result ? (result.affectedRows || result.changes || 0) : 0;
        return { deleted: affected > 0, softDeleted: false };
    }
}
