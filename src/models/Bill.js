import { v4 as uuidv4 } from 'uuid';
import { query, queryOne, insert, beginTransaction } from '../config/database.js';
import { generateBillNumber, calculateBillTotals } from '../utils/helpers.js';

export default class Bill {
    constructor(data) {
        this.id = data.id || uuidv4();
        this.user_id = data.user_id;
        this.template_id = data.template_id;
        this.customer_id = data.customer_id || null;
        this.customer_name = data.customer_name || '';
        this.customer_phone = data.customer_phone || '';
        this.number = data.number || generateBillNumber();
        this.items = data.items || [];
        this.discount = Number(data.discount || 0);
        this.tax_rate = Number(data.tax_rate || 0);
        this.payment_mode = data.payment_mode || 'Cash';
        this.shop_name = data.shop_name || '';
        this.shop_address = data.shop_address || '';
        this.shop_phone = data.shop_phone || '';
        this.template_name = data.template_name || '';
        this.template_width = data.template_width || '58mm';
        this.subtotal = Number(data.subtotal || 0);
        this.tax_amount = Number(data.tax_amount || 0);
        this.total = Number(data.total || 0);
        this.created_at = data.created_at;
    }

    static async create(billData) {
        const totals = calculateBillTotals(billData.items, billData.discount, billData.tax_rate);
        
        let billNumber = billData.number;
        if (!billNumber || billNumber === 'SLP-DRAFT' || billNumber.trim() === '') {
            billNumber = generateBillNumber(
                billData.shop?.invoice_prefix || 'SLP',
                billData.shop?.invoice_sequence || 1001,
                billData.shop?.invoice_format || 'PREFIX-DATE-SEQ'
            );
        }

        const bill = {
            id: uuidv4(),
            user_id: billData.user_id,
            template_id: billData.template_id,
            customer_id: billData.customer_id || null,
            customer_name: billData.customer_name || '',
            customer_phone: billData.customer_phone || '',
            number: billNumber,
            discount: Number(billData.discount) || 0,
            tax_rate: Number(billData.tax_rate) || 0,
            payment_mode: billData.payment_mode || 'Cash',
            shop_name: billData.shop_name || '',
            shop_address: billData.shop_address || '',
            shop_phone: billData.shop_phone || '',
            template_name: billData.template_name || '',
            template_width: billData.template_width || '58mm',
            subtotal: totals.subtotal,
            tax_amount: totals.tax_amount,
            total: totals.total
        };

        const connection = await beginTransaction();

        try {
            // Insert bill
            const keys = Object.keys(bill);
            const values = Object.values(bill);
            const placeholders = keys.map(() => '?').join(', ');
            
            await connection.query(
                `INSERT INTO bills (${keys.join(', ')}) VALUES (${placeholders})`,
                values
            );

            // Insert bill items
            for (const item of billData.items) {
                const itemData = {
                    id: uuidv4(),
                    bill_id: bill.id,
                    name: item.name,
                    quantity: Number(item.quantity) || 1,
                    rate: Number(item.rate) || 0,
                    amount: (Number(item.quantity) || 1) * (Number(item.rate) || 0)
                };
                
                const itemKeys = Object.keys(itemData);
                const itemValues = Object.values(itemData);
                const itemPlaceholders = itemKeys.map(() => '?').join(', ');
                
                await connection.query(
                    `INSERT INTO bill_items (${itemKeys.join(', ')}) VALUES (${itemPlaceholders})`,
                    itemValues
                );
            }

            // Increment shop's invoice sequence if shop exists
            await connection.query(
                `UPDATE shops SET invoice_sequence = COALESCE(invoice_sequence, 1000) + 1 WHERE user_id = ?`,
                [billData.user_id]
            );

            await connection.commit();
            connection.release();

            // Fetch complete bill with items
            return await Bill.findById(bill.id);
        } catch (err) {
            await connection.rollback();
            connection.release();
            throw err;
        }
    }

    static async findById(id) {
        const billData = await queryOne('SELECT * FROM bills WHERE id = ?', [id]);
        if (!billData) return null;

        const items = await query('SELECT * FROM bill_items WHERE bill_id = ?', [id]);
        return new Bill({ ...billData, items });
    }

    static async findByIdAndUser(id, userId) {
        const billData = await queryOne('SELECT * FROM bills WHERE id = ? AND user_id = ?', [id, userId]);
        if (!billData) return null;

        const items = await query('SELECT * FROM bill_items WHERE bill_id = ?', [id]);
        return new Bill({ ...billData, items });
    }

    static async findByUserId(userId, options = {}) {
        const { page, limit, search, payment_mode } = options;

        let baseSql = `FROM bills WHERE user_id = ?`;
        const params = [userId];

        if (search && search.trim()) {
            baseSql += ` AND (number LIKE ? OR customer_name LIKE ? OR customer_phone LIKE ?)`;
            const term = `%${search.trim()}%`;
            params.push(term, term, term);
        }

        if (payment_mode && payment_mode !== 'All') {
            baseSql += ` AND payment_mode = ?`;
            params.push(payment_mode);
        }

        // If pagination options are provided
        if (page !== undefined && limit !== undefined) {
            const countResult = await queryOne(`SELECT COUNT(*) as total ${baseSql}`, params);
            const total = Number(countResult?.total || 0);

            const offset = (Math.max(1, Number(page)) - 1) * Number(limit);
            const queryParams = [...params, Number(limit), Number(offset)];
            const bills = await query(
                `SELECT * ${baseSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
                queryParams
            );

            if (bills.length > 0) {
                const billIds = bills.map(b => b.id);
                const placeholders = billIds.map(() => '?').join(',');
                const allItems = await query(`SELECT * FROM bill_items WHERE bill_id IN (${placeholders})`, billIds);
                const itemsByBillId = {};
                for (const item of (allItems || [])) {
                    if (!itemsByBillId[item.bill_id]) itemsByBillId[item.bill_id] = [];
                    itemsByBillId[item.bill_id].push(item);
                }
                for (const bill of bills) {
                    bill.items = itemsByBillId[bill.id] || [];
                }
            }

            return {
                bills: bills.map(b => new Bill(b)),
                total,
                page: Number(page),
                limit: Number(limit),
                totalPages: Math.ceil(total / Number(limit)) || 1
            };
        }

        // Default: return all bills array
        const bills = await query(`SELECT * ${baseSql} ORDER BY created_at DESC`, params);
        if (bills.length > 0) {
            const billIds = bills.map(b => b.id);
            const placeholders = billIds.map(() => '?').join(',');
            const allItems = await query(`SELECT * FROM bill_items WHERE bill_id IN (${placeholders})`, billIds);
            const itemsByBillId = {};
            for (const item of (allItems || [])) {
                if (!itemsByBillId[item.bill_id]) itemsByBillId[item.bill_id] = [];
                itemsByBillId[item.bill_id].push(item);
            }
            for (const bill of bills) {
                bill.items = itemsByBillId[bill.id] || [];
            }
        }
        return bills.map(b => new Bill(b));
    }

    static async getTodaySales(userId) {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const res = await queryOne(
            `SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as total FROM bills WHERE user_id = ? AND created_at >= ?`,
            [userId, todayStart.toISOString()]
        );
        return {
            count: Number(res?.count || 0),
            total: Number(res?.total || 0)
        };
    }
}