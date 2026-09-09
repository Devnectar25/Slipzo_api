import { v4 as uuidv4 } from 'uuid';
import { query, queryOne, insert, update, deleteById } from '../config/database.js';

export default class Customer {
    constructor(data) {
        this.id = data.id || uuidv4();
        this.user_id = data.user_id;
        this.name = data.name;
        this.phone = data.phone || '';
        this.email = data.email || '';
        this.address = data.address || '';
        this.gstin = data.gstin || '';
        this.notes = data.notes || '';
        this.total_bills = Number(data.total_bills || 0);
        this.total_spent = Number(data.total_spent || 0);
        this.last_bill_date = data.last_bill_date || null;
        this.created_at = data.created_at;
        this.updated_at = data.updated_at;
    }

    static async create(customerData) {
        const customer = {
            id: uuidv4(),
            user_id: customerData.user_id,
            name: customerData.name.trim(),
            phone: customerData.phone?.trim() || '',
            email: customerData.email?.trim() || '',
            address: customerData.address?.trim() || '',
            gstin: customerData.gstin?.trim() || '',
            notes: customerData.notes?.trim() || ''
        };

        await insert('customers', customer);
        return await Customer.findByIdAndUser(customer.id, customer.user_id);
    }

    static async findByUserId(userId, search = '') {
        let sql = `
            SELECT c.*, 
                   COUNT(b.id) AS total_bills, 
                   COALESCE(SUM(b.total), 0) AS total_spent,
                   MAX(b.created_at) AS last_bill_date
            FROM customers c
            LEFT JOIN bills b ON (b.customer_id = c.id OR (b.customer_phone = c.phone AND c.phone != ''))
            WHERE c.user_id = ?
        `;
        const params = [userId];

        if (search && search.trim()) {
            sql += ` AND (c.name LIKE ? OR c.phone LIKE ? OR c.email LIKE ?)`;
            const term = `%${search.trim()}%`;
            params.push(term, term, term);
        }

        sql += ` GROUP BY c.id ORDER BY c.created_at DESC`;

        const rows = await query(sql, params);
        return rows.map(r => new Customer(r));
    }

    static async findByIdAndUser(id, userId) {
        const sql = `
            SELECT c.*, 
                   COUNT(b.id) AS total_bills, 
                   COALESCE(SUM(b.total), 0) AS total_spent,
                   MAX(b.created_at) AS last_bill_date
            FROM customers c
            LEFT JOIN bills b ON (b.customer_id = c.id OR (b.customer_phone = c.phone AND c.phone != ''))
            WHERE c.id = ? AND c.user_id = ?
            GROUP BY c.id
        `;
        const data = await queryOne(sql, [id, userId]);
        return data ? new Customer(data) : null;
    }

    static async findByPhone(phone, userId) {
        if (!phone) return null;
        const data = await queryOne(
            'SELECT * FROM customers WHERE phone = ? AND user_id = ?',
            [phone, userId]
        );
        return data ? new Customer(data) : null;
    }

    static async update(id, userId, updates) {
        const allowed = ['name', 'phone', 'email', 'address', 'gstin', 'notes'];
        const filteredUpdates = {};
        for (const key of allowed) {
            if (updates[key] !== undefined) {
                filteredUpdates[key] = typeof updates[key] === 'string' ? updates[key].trim() : updates[key];
            }
        }

        if (Object.keys(filteredUpdates).length === 0) {
            return await Customer.findByIdAndUser(id, userId);
        }

        await update('customers', filteredUpdates, 'id = ? AND user_id = ?', [id, userId]);
        return await Customer.findByIdAndUser(id, userId);
    }

    static async delete(id, userId) {
        const result = await query(
            'DELETE FROM customers WHERE id = ? AND user_id = ?',
            [id, userId]
        );
        return result.affectedRows > 0;
    }

    static async getCustomerBills(id, userId) {
        const customer = await Customer.findByIdAndUser(id, userId);
        if (!customer) return [];

        const bills = await query(
            `SELECT b.* FROM bills b
             WHERE b.user_id = ? AND (b.customer_id = ? OR (b.customer_phone = ? AND ? != ''))
             ORDER BY b.created_at DESC`,
            [userId, id, customer.phone, customer.phone]
        );

        for (const bill of bills) {
            bill.items = await query('SELECT * FROM bill_items WHERE bill_id = ?', [bill.id]);
        }

        return bills;
    }

    static async getStats(userId) {
        const totalCustomers = await queryOne(
            'SELECT COUNT(*) as count FROM customers WHERE user_id = ?',
            [userId]
        );

        const activeCustomers = await queryOne(
            `SELECT COUNT(DISTINCT c.id) as count 
             FROM customers c 
             JOIN bills b ON (b.customer_id = c.id OR (b.customer_phone = c.phone AND c.phone != ''))
             WHERE c.user_id = ? AND b.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`,
            [userId]
        );

        const totalRevenue = await queryOne(
            `SELECT COALESCE(SUM(b.total), 0) as total 
             FROM bills b 
             WHERE b.user_id = ? AND (b.customer_id IS NOT NULL OR (b.customer_phone IS NOT NULL AND b.customer_phone != ''))`,
            [userId]
        );

        return {
            totalCustomers: Number(totalCustomers?.count || 0),
            activeCustomers: Number(activeCustomers?.count || 0),
            totalRevenue: Number(totalRevenue?.total || 0)
        };
    }
}
