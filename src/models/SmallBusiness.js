import { v4 as uuidv4 } from 'uuid';
import { query, queryOne, insert, update } from '../config/database.js';

export default class SmallBusiness {
    constructor(data) {
        this.id = data.id || uuidv4();
        this.user_id = data.user_id || null;
        this.name = data.name;
        this.price = Number(data.price || 0);
        this.category = data.category || 'General';
        this.image_url = data.image_url || '';
        this.description = data.description || '';
        this.is_available = data.is_available !== undefined ? Boolean(data.is_available) : true;
        this.barcode = data.barcode || '';
        this.barcode_type = data.barcode_type || 'INTERNAL';
        this.created_at = data.created_at;
        this.updated_at = data.updated_at;
        // User catalog assignment metadata
        this.is_added = data.is_added !== undefined ? Boolean(data.is_added) : false;
        this.user_menu_item_id = data.user_menu_item_id || null;
        this.user_price = data.user_price !== undefined && data.user_price !== null ? Number(data.user_price) : null;
    }

    /**
     * Fetch the Available Master Catalog from small_business for a specific user
     * Marks items as `is_added: true` if already in the user's personal menu
     */
    static async findCatalogForUser(userId, search = '', category = 'all') {
        let sql = `
            SELECT 
                sb.id,
                sb.name,
                sb.price,
                sb.category,
                sb.image_url,
                sb.description,
                sb.is_available,
                sb.barcode,
                sb.barcode_type,
                sb.created_at,
                sb.updated_at,
                umi.id as user_menu_item_id,
                umi.custom_price as user_price,
                CASE WHEN umi.id IS NOT NULL THEN true ELSE false END as is_added
            FROM small_business sb
            LEFT JOIN user_menu_items umi 
                ON sb.id = umi.menu_item_id AND umi.user_id = ?
            WHERE (sb.is_available IS NOT FALSE)
        `;
        const params = [userId];

        if (search && search.trim()) {
            sql += ` AND (LOWER(sb.name) LIKE LOWER(?) OR LOWER(sb.barcode) LIKE LOWER(?) OR LOWER(sb.category) LIKE LOWER(?))`;
            params.push(`%${search.trim()}%`, `%${search.trim()}%`, `%${search.trim()}%`);
        }

        if (category && category !== 'all' && category !== 'All') {
            sql += ` AND LOWER(sb.category) = LOWER(?)`;
            params.push(category.trim());
        }

        sql += ` ORDER BY sb.barcode ASC, sb.name ASC`;

        const rows = await query(sql, params);
        return (rows || []).map(r => new SmallBusiness(r));
    }

    static async findAll({ search = '', category = 'all', page = 1, limit = 100 } = {}) {
        let whereClause = ` WHERE 1=1`;
        const params = [];

        if (search && search.trim()) {
            whereClause += ` AND (LOWER(name) LIKE LOWER(?) OR LOWER(category) LIKE LOWER(?) OR LOWER(barcode) LIKE LOWER(?))`;
            params.push(`%${search.trim()}%`, `%${search.trim()}%`, `%${search.trim()}%`);
        }

        if (category && category !== 'all' && category !== 'All') {
            whereClause += ` AND LOWER(category) = LOWER(?)`;
            params.push(category.trim());
        }

        const countSql = `SELECT COUNT(*) as total FROM small_business` + whereClause;
        const countRes = await queryOne(countSql, params);
        const total = countRes ? (countRes.total || countRes.count || 0) : 0;

        const offset = Math.max(0, (page - 1) * limit);
        const dataSql = `SELECT * FROM small_business` + whereClause + ` ORDER BY barcode ASC LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}`;
        const rows = await query(dataSql, params);

        return {
            items: (rows || []).map(r => new SmallBusiness(r)),
            total: Number(total),
            page: Number(page),
            limit: Number(limit),
            totalPages: Math.ceil(total / limit) || 1
        };
    }

    static async findById(id) {
        const sql = `SELECT * FROM small_business WHERE id = ?`;
        const data = await queryOne(sql, [id]);
        return data ? new SmallBusiness(data) : null;
    }

    static async findByBarcode(barcode) {
        if (!barcode || !String(barcode).trim()) return null;
        const clean = String(barcode).trim();
        const sql = `SELECT * FROM small_business WHERE LOWER(barcode) = LOWER(?)`;
        const data = await queryOne(sql, [clean]);
        return data ? new SmallBusiness(data) : null;
    }

    static async create(data) {
        const name = (data.name || '').trim();
        const price = Math.max(0, parseFloat(data.price) || 0);
        const category = (data.category || 'General').trim();
        const imageUrl = data.image_url || '';
        const description = (data.description || '').trim();
        const isAvailable = data.is_available !== undefined ? Boolean(data.is_available) : true;
        const barcode = (data.barcode || '').trim();
        const barcodeType = (data.barcode_type || 'INTERNAL').trim().toUpperCase();
        const now = new Date().toISOString();

        const newItem = {
            id: data.id || uuidv4(),
            user_id: data.user_id || null,
            name,
            price,
            category,
            image_url: imageUrl,
            description,
            is_available: isAvailable,
            barcode,
            barcode_type: barcodeType,
            created_at: now,
            updated_at: now
        };

        await insert('small_business', newItem);
        return await SmallBusiness.findById(newItem.id);
    }
}

