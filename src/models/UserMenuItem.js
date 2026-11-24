import { v4 as uuidv4 } from 'uuid';
import { query, queryOne, insert, update } from '../config/database.js';
import { normalizeUnit } from '../utils/units.js';
import { normalizeGstRate } from '../utils/gst.js';

// 1 when a shop owner's own item has a category the catalog does not have (typed by the owner): the app gives
// such a category its own filter button
const OWN_CATEGORY_SQL = `CASE WHEN mi.user_id IS NOT NULL AND LOWER(TRIM(mi.category)) NOT IN (
                    SELECT LOWER(TRIM(category)) FROM small_business WHERE category IS NOT NULL
                    UNION SELECT LOWER(TRIM(category)) FROM kirana_store WHERE category IS NOT NULL
                    UNION SELECT LOWER(TRIM(category)) FROM clothing_garments WHERE category IS NOT NULL
                    UNION SELECT LOWER(TRIM(category)) FROM hotel_food WHERE category IS NOT NULL
                ) THEN 1 ELSE 0 END as own_category`;

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
        this.own_category = Number(data.own_category) === 1;
        this.image_url = data.image_url || '';
        this.description = data.description || '';
        this.barcode = data.barcode || '';
        const rawBActive = data.barcode_active;
        this.barcode_active = (rawBActive === false || rawBActive === 0 || rawBActive === '0' || rawBActive === 'false') ? false : true;
        this.is_available = data.is_available !== undefined ? Boolean(data.is_available) : true;
        this.is_active = data.is_active !== undefined ? Boolean(data.is_active) : true;
        this.business_type = data.business_type || 'small_business';
        // stock (inventory shops): null stock_qty = not tracked yet
        const rawTrack = data.track_stock;
        this.track_stock = rawTrack === true || rawTrack === 1 || rawTrack === '1' || rawTrack === 't' || rawTrack === 'true';
        this.stock_qty = data.stock_qty === null || data.stock_qty === undefined ? null : Number(data.stock_qty);
        this.low_stock_alert = data.low_stock_alert === null || data.low_stock_alert === undefined ? 5 : Number(data.low_stock_alert);
        // loose item: sold by this measuring unit (kg, g, l, ml, m, dozen); null = counted in pieces
        this.unit = normalizeUnit(data.unit);
        // GST % added on top of the selling price (used when the shop has GST turned on)
        this.gst_rate = normalizeGstRate(data.gst_rate);
        this.created_at = data.created_at;
        this.updated_at = data.updated_at;
    }

    static async findByUserId(userId, search = '', category = 'all', businessType = '') {
        let sql = `
            SELECT 
                umi.id,
                umi.user_id,
                umi.menu_item_id,
                umi.custom_price,
                umi.custom_price as price,
                umi.is_active,
                COALESCE(umi.barcode_active, true) as barcode_active,
                umi.stock_qty,
                umi.low_stock_alert,
                umi.track_stock,
                umi.unit,
                umi.gst_rate,
                umi.created_at,
                umi.updated_at,
                COALESCE(sb.name, mi.name, cg.name, hf.name, ks.name, '') as name,
                COALESCE(sb.category, mi.category, cg.category, hf.category, ks.category, 'General') as category,
                ${OWN_CATEGORY_SQL},
                COALESCE(sb.image_url, mi.image_url, cg.image_url, hf.image_url, ks.image_url, '') as image_url,
                COALESCE(sb.description, mi.description, cg.description, hf.description, ks.description, '') as description,
                COALESCE(sb.barcode, mi.barcode, cg.barcode, hf.barcode, ks.barcode, '') as barcode,
                COALESCE(sb.barcode_type, mi.barcode_type, cg.barcode_type, hf.barcode_type, ks.barcode_type, 'INTERNAL') as barcode_type,
                COALESCE(sb.is_available, mi.is_available, cg.is_available, hf.is_available, ks.is_available, true) as is_available,
                COALESCE(sb.business_type, mi.business_type, cg.business_type, hf.business_type, ks.business_type, 'small_business') as business_type,
                COALESCE(sb.price, mi.price, cg.price, hf.price, ks.price, 0) as catalog_price
            FROM user_menu_items umi
            LEFT JOIN small_business sb ON umi.menu_item_id = sb.id
            LEFT JOIN menu_items mi ON umi.menu_item_id = mi.id
            LEFT JOIN clothing_garments cg ON umi.menu_item_id = cg.id
            LEFT JOIN hotel_food hf ON umi.menu_item_id = hf.id
            LEFT JOIN kirana_store ks ON umi.menu_item_id = ks.id
            WHERE umi.user_id = ?
        `;
        const params = [userId];

        if (businessType && businessType !== 'all' && businessType !== 'All') {
            // Items the shop owner created themselves always show, whichever type they were tagged with
            // (older custom items were often saved under the wrong type and would otherwise stay hidden)
            sql += ` AND (
                LOWER(COALESCE(sb.business_type, mi.business_type, cg.business_type, hf.business_type, ks.business_type, 'small_business')) = LOWER(?)
                OR sb.user_id = umi.user_id
                OR mi.user_id = umi.user_id
            )`;
            params.push(businessType.trim());
        }

        if (search && search.trim()) {
            sql += ` AND (
                LOWER(COALESCE(sb.name, mi.name, cg.name, hf.name, ks.name, '')) LIKE LOWER(?) OR 
                LOWER(COALESCE(sb.barcode, mi.barcode, cg.barcode, hf.barcode, ks.barcode, '')) LIKE LOWER(?) OR 
                LOWER(COALESCE(sb.category, mi.category, cg.category, hf.category, ks.category, '')) LIKE LOWER(?)
            )`;
            params.push(`%${search.trim()}%`, `%${search.trim()}%`, `%${search.trim()}%`);
        }

        if (category && category !== 'all' && category !== 'All') {
            sql += ` AND LOWER(COALESCE(sb.category, mi.category, cg.category, hf.category, ks.category, 'General')) = LOWER(?)`;
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
                umi.stock_qty,
                umi.low_stock_alert,
                umi.track_stock,
                umi.unit,
                umi.gst_rate,
                umi.created_at,
                umi.updated_at,
                COALESCE(sb.name, mi.name, cg.name, hf.name, ks.name, '') as name,
                COALESCE(sb.category, mi.category, cg.category, hf.category, ks.category, 'General') as category,
                ${OWN_CATEGORY_SQL},
                COALESCE(sb.image_url, mi.image_url, cg.image_url, hf.image_url, ks.image_url, '') as image_url,
                COALESCE(sb.description, mi.description, cg.description, hf.description, ks.description, '') as description,
                COALESCE(sb.barcode, mi.barcode, cg.barcode, hf.barcode, ks.barcode, '') as barcode,
                COALESCE(sb.barcode_type, mi.barcode_type, cg.barcode_type, hf.barcode_type, ks.barcode_type, 'INTERNAL') as barcode_type,
                COALESCE(sb.is_available, mi.is_available, cg.is_available, hf.is_available, ks.is_available, true) as is_available,
                COALESCE(sb.price, mi.price, cg.price, hf.price, ks.price, 0) as catalog_price
            FROM user_menu_items umi
            LEFT JOIN small_business sb ON umi.menu_item_id = sb.id
            LEFT JOIN menu_items mi ON umi.menu_item_id = mi.id
            LEFT JOIN clothing_garments cg ON umi.menu_item_id = cg.id
            LEFT JOIN hotel_food hf ON umi.menu_item_id = hf.id
            LEFT JOIN kirana_store ks ON umi.menu_item_id = ks.id
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
                umi.stock_qty,
                umi.low_stock_alert,
                umi.track_stock,
                umi.unit,
                umi.gst_rate,
                umi.created_at,
                umi.updated_at,
                COALESCE(sb.name, mi.name, cg.name, hf.name, ks.name, '') as name,
                COALESCE(sb.category, mi.category, cg.category, hf.category, ks.category, 'General') as category,
                ${OWN_CATEGORY_SQL},
                COALESCE(sb.image_url, mi.image_url, cg.image_url, hf.image_url, ks.image_url, '') as image_url,
                COALESCE(sb.description, mi.description, cg.description, hf.description, ks.description, '') as description,
                COALESCE(sb.barcode, mi.barcode, cg.barcode, hf.barcode, ks.barcode, '') as barcode,
                COALESCE(sb.barcode_type, mi.barcode_type, cg.barcode_type, hf.barcode_type, ks.barcode_type, 'INTERNAL') as barcode_type,
                COALESCE(sb.is_available, mi.is_available, cg.is_available, hf.is_available, ks.is_available, true) as is_available,
                COALESCE(sb.price, mi.price, cg.price, hf.price, ks.price, 0) as catalog_price
            FROM user_menu_items umi
            LEFT JOIN small_business sb ON umi.menu_item_id = sb.id
            LEFT JOIN menu_items mi ON umi.menu_item_id = mi.id
            LEFT JOIN clothing_garments cg ON umi.menu_item_id = cg.id
            LEFT JOIN hotel_food hf ON umi.menu_item_id = hf.id
            LEFT JOIN kirana_store ks ON umi.menu_item_id = ks.id
            WHERE umi.user_id = ? 
              AND (LOWER(COALESCE(sb.barcode, mi.barcode, cg.barcode, hf.barcode, ks.barcode, '')) = LOWER(?))
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

    static async create(userId, menuItemId, customPrice, barcodeActive = true, stock = null) {
        const isBActive = barcodeActive !== false;
        const unit = stock && stock.unit !== undefined ? normalizeUnit(stock.unit) : undefined;
        const gstRate = stock && stock.gstRate !== undefined ? normalizeGstRate(stock.gstRate) : undefined;
        const existing = await UserMenuItem.findByUserAndMenuItem(userId, menuItemId);
        if (existing) {
            const numPrice = Math.max(0, parseFloat(customPrice) || 0);
            await update(
                'user_menu_items',
                { custom_price: numPrice, is_active: true, barcode_active: isBActive, ...(unit !== undefined ? { unit } : {}), ...(gstRate !== undefined ? { gst_rate: gstRate } : {}), updated_at: new Date().toISOString() },
                'id = ? AND user_id = ?',
                [existing.id, userId]
            );
            return await UserMenuItem.findByIdAndUser(existing.id, userId);
        }

        // Prevent adding an item that has the same name as another item in user's menu
        const targetItem = await queryOne(`
            SELECT COALESCE(sb.name, ks.name, cg.name, hf.name, mi.name, '') as name
            FROM (SELECT ? as id) t
            LEFT JOIN small_business sb ON t.id = sb.id
            LEFT JOIN kirana_store ks ON t.id = ks.id
            LEFT JOIN clothing_garments cg ON t.id = cg.id
            LEFT JOIN hotel_food hf ON t.id = hf.id
            LEFT JOIN menu_items mi ON t.id = mi.id
        `, [menuItemId]);

        if (targetItem && targetItem.name) {
            const sameNameItem = await queryOne(`
                SELECT umi.id 
                FROM user_menu_items umi
                LEFT JOIN small_business sb ON umi.menu_item_id = sb.id
                LEFT JOIN kirana_store ks ON umi.menu_item_id = ks.id
                LEFT JOIN clothing_garments cg ON umi.menu_item_id = cg.id
                LEFT JOIN hotel_food hf ON umi.menu_item_id = hf.id
                LEFT JOIN menu_items mi ON umi.menu_item_id = mi.id
                WHERE umi.user_id = ? AND umi.menu_item_id != ? AND LOWER(TRIM(COALESCE(sb.name, ks.name, cg.name, hf.name, mi.name, ''))) = LOWER(TRIM(?))
                LIMIT 1
            `, [userId, menuItemId, targetItem.name]);

            if (sameNameItem) {
                const err = new Error(`Product "${targetItem.name}" is already in your menu.`);
                err.statusCode = 400;
                throw err;
            }
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
            unit: unit || null,
            gst_rate: gstRate || 0,
            created_at: now,
            updated_at: now
        };
        const openingQty = stock && stock.qty !== undefined && stock.qty !== null && stock.qty !== '' ? Number(stock.qty) : null;
        if (openingQty !== null && Number.isFinite(openingQty)) {
            newItem.track_stock = true;
            newItem.stock_qty = Math.max(0, openingQty);
        }
        if (stock && stock.lowAlert !== undefined && stock.lowAlert !== null && stock.lowAlert !== '' && Number.isFinite(Number(stock.lowAlert))) {
            newItem.low_stock_alert = Math.max(0, Number(stock.lowAlert));
        }

        await insert('user_menu_items', newItem);
        if (newItem.track_stock) {
            await insert('stock_movements', {
                id: uuidv4(),
                user_id: userId,
                user_menu_item_id: id,
                change: newItem.stock_qty,
                balance_after: newItem.stock_qty,
                reason: 'opening',
                note: 'Opening stock',
                created_at: now
            }).catch(() => null);
        }
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
        if (updates.low_stock_alert !== undefined && updates.low_stock_alert !== null && updates.low_stock_alert !== '' && Number.isFinite(Number(updates.low_stock_alert))) {
            updateFields.low_stock_alert = Math.max(0, Number(updates.low_stock_alert));
        }
        if (updates.track_stock !== undefined) {
            updateFields.track_stock = Boolean(updates.track_stock);
        }
        if (updates.unit !== undefined) {
            updateFields.unit = normalizeUnit(updates.unit);
        }
        if (updates.gst_rate !== undefined) {
            updateFields.gst_rate = normalizeGstRate(updates.gst_rate);
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

