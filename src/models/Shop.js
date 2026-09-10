import { v4 as uuidv4 } from 'uuid';
import { query, queryOne, insert, update } from '../config/database.js';

export default class Shop {
    constructor(data) {
        this.id = data.id || uuidv4();
        this.user_id = data.user_id;
        this.name = data.name;
        this.address = data.address || '';
        this.phone = data.phone || '';
        this.gstin = data.gstin || '';
        this.show_tax = data.show_tax !== undefined ? Number(data.show_tax) : 1;
        this.tax_rate = Number(data.tax_rate !== undefined ? data.tax_rate : 18.00);
        this.invoice_prefix = data.invoice_prefix || 'SLP';
        this.invoice_sequence = Number(data.invoice_sequence || 1001);
        this.invoice_format = data.invoice_format || 'PREFIX-DATE-SEQ';
        this.created_at = data.created_at;
        this.updated_at = data.updated_at;
    }

    static async create(shopData) {
        const shop = {
            id: uuidv4(),
            ...shopData
        };
        await insert('shops', shop);
        return new Shop(shop);
    }

    static async findByUserId(userId) {
        const data = await queryOne('SELECT * FROM shops WHERE user_id = ?', [userId]);
        return data ? new Shop(data) : null;
    }

    static async update(userId, updates) {
        const result = await update('shops', updates, 'user_id = ?', [userId]);
        if (result.affectedRows === 0) return null;
        
        return await Shop.findByUserId(userId);
    }

    static async findById(id) {
        const data = await queryOne('SELECT * FROM shops WHERE id = ?', [id]);
        return data ? new Shop(data) : null;
    }
}