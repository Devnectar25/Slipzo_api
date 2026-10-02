import { query, queryOne } from '../config/database.js';

export default class Catalog {
    /**
     * Map business_type to database table name
     */
    static getTableName(businessType) {
        const type = String(businessType || '').toLowerCase().trim();
        switch (type) {
            case 'kirana_grocery':
            case 'kirana':
            case 'grocery':
                return 'menu_items';
            case 'clothing_garments':
            case 'clothing':
            case 'garments':
                return 'clothing_garments';
            case 'hotel_food':
            case 'hotel':
            case 'restaurant':
                return 'hotel_food';
            case 'small_business':
            default:
                return 'small_business';
        }
    }

    /**
     * Fetch catalog for a specific business type and user
     */
    static async findCatalogForUser(userId, businessType = 'small_business', search = '', category = 'all') {
        const tableName = this.getTableName(businessType);

        let sql = `
            SELECT 
                cat.id,
                cat.name,
                cat.price,
                cat.category,
                cat.image_url,
                cat.description,
                cat.is_available,
                cat.barcode,
                cat.barcode_type,
                COALESCE(cat.barcode_active, true) as barcode_active,
                cat.created_at,
                cat.updated_at,
                umi.id as user_menu_item_id,
                umi.custom_price as user_price,
                COALESCE(umi.barcode_active, true) as user_barcode_active,
                CASE WHEN umi.id IS NOT NULL THEN true ELSE false END as is_added,
                '${businessType}' as business_type
            FROM ${tableName} cat
            LEFT JOIN user_menu_items umi 
                ON cat.id = umi.menu_item_id AND umi.user_id = ?
            WHERE (cat.is_available IS NOT FALSE)
        `;
        const params = [userId];

        if (search && search.trim()) {
            sql += ` AND (LOWER(cat.name) LIKE LOWER(?) OR LOWER(cat.barcode) LIKE LOWER(?) OR LOWER(cat.category) LIKE LOWER(?))`;
            params.push(`%${search.trim()}%`, `%${search.trim()}%`, `%${search.trim()}%`);
        }

        if (category && category !== 'all' && category !== 'All') {
            sql += ` AND LOWER(cat.category) = LOWER(?)`;
            params.push(category.trim());
        }

        sql += ` ORDER BY cat.barcode ASC, cat.name ASC`;

        const rows = await query(sql, params);
        return (rows || []).map(r => ({
            id: r.id,
            name: r.name,
            price: Number(r.price || 0),
            category: r.category || 'General',
            image_url: r.image_url || '',
            description: r.description || '',
            is_available: r.is_available !== undefined ? Boolean(r.is_available) : true,
            barcode: r.barcode || '',
            barcode_type: r.barcode_type || 'INTERNAL',
            barcode_active: r.user_barcode_active !== undefined ? Boolean(r.user_barcode_active) : (r.barcode_active !== undefined ? Boolean(r.barcode_active) : true),
            is_added: Boolean(r.is_added),
            user_menu_item_id: r.user_menu_item_id || null,
            user_price: r.user_price !== undefined && r.user_price !== null ? Number(r.user_price) : null,
            business_type: businessType
        }));
    }

    /**
     * Search for a master item by barcode across all 4 catalog tables
     */
    static async findByBarcode(barcode) {
        if (!barcode || !String(barcode).trim()) return null;
        const clean = String(barcode).trim();

        const tables = ['small_business', 'menu_items', 'clothing_garments', 'hotel_food'];
        for (const table of tables) {
            const sql = `SELECT * FROM ${table} WHERE LOWER(barcode) = LOWER(?) LIMIT 1`;
            const row = await queryOne(sql, [clean]);
            if (row) return row;
        }
        return null;
    }
}

