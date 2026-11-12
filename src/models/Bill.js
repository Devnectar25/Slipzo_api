import { v4 as uuidv4 } from 'uuid';
import { query, queryOne, insert, beginTransaction } from '../config/database.js';
import { generateBillNumber, calculateBillTotals } from '../utils/helpers.js';
import RestaurantTable from './RestaurantTable.js';

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
        this.total = Number(data.total !== undefined && data.total !== null ? data.total : (data.total_amount !== undefined && data.total_amount !== null ? data.total_amount : (data.amount !== undefined && data.amount !== null ? data.amount : 0)));
        this.total_amount = this.total;
        this.table_number = data.table_number || '';
        this.is_saved = data.is_saved !== undefined ? Number(data.is_saved) : 1;
        this.created_at = data.created_at;
    }

    static async create(billData) {
        const totals = calculateBillTotals(billData.items, billData.discount, billData.tax_rate);
        
        let shopInfo = billData.shop;
        if (!shopInfo && billData.user_id) {
            shopInfo = await queryOne('SELECT * FROM shops WHERE user_id = ?', [billData.user_id]);
        }
        shopInfo = shopInfo || {};

        let currentSeq = Number(shopInfo.invoice_sequence) || 1001;
        const prefix = shopInfo.invoice_prefix || 'SLP';
        const format = shopInfo.invoice_format || 'PREFIX-DATE-SEQ';

        let billNumber = billData.number ? String(billData.number).trim() : '';
        if (!billNumber || billNumber === 'SLP-DRAFT') {
            billNumber = generateBillNumber(prefix, currentSeq, format);
        }

        // Pre-check uniqueness of billNumber, incrementing sequence if already taken
        // (bills live in saved_bills / print_bills; the old "bills" table is not where new bills go)
        const numberTaken = (num) => queryOne(
            'SELECT id FROM saved_bills WHERE number = ? AND user_id = ? UNION ALL SELECT id FROM print_bills WHERE number = ? AND user_id = ? LIMIT 1',
            [num, billData.user_id, num, billData.user_id]
        );
        let existing = await numberTaken(billNumber);
        let attempts = 0;
        while (existing && attempts < 100) {
            attempts++;
            currentSeq++;
            billNumber = generateBillNumber(prefix, currentSeq, format);
            existing = await numberTaken(billNumber);
        }

        let insertedBillId = null;
        let retryCount = 0;

        while (!insertedBillId && retryCount < 25) {
            retryCount++;
            const connection = await beginTransaction();

            try {
                // Atomic print quota verification inside transaction
                const subRows = await connection.query(
                    `SELECT SUM(prints_count) as total_purchased FROM subscriptions WHERE user_id = ? AND (payment_status = 'completed' OR payment_status IS NULL)`,
                    [billData.user_id]
                );
                const purchasedPrints = Number(subRows[0]?.total_purchased || 0);
                const totalPrints = 10 + purchasedPrints;

                const billRows = await connection.query(
                    `SELECT ((SELECT COUNT(*) FROM saved_bills WHERE user_id = ?) + (SELECT COUNT(*) FROM print_bills WHERE user_id = ?)) as used_count`,
                    [billData.user_id, billData.user_id]
                );
                const usedPrints = Number(billRows[0]?.used_count || 0);

                if (totalPrints - usedPrints <= 0) {
                    const quotaErr = new Error('Print quota limit reached. You have 0 prints remaining. Please purchase a plan to create more bills.');
                    quotaErr.statusCode = 403;
                    throw quotaErr;
                }

                const rawTableNum = billData.table_number || billData.table || billData.table_name || '';
                const cleanTableNum = rawTableNum ? String(rawTableNum).trim() : null;
                const isSaved = billData.is_saved !== undefined ? Boolean(billData.is_saved) : false;
                const mainTable = isSaved ? 'saved_bills' : 'print_bills';
                const mainItemsTable = isSaved ? 'saved_bill_items' : 'print_bill_items';

                const bill = {
                    id: uuidv4(),
                    user_id: billData.user_id,
                    template_id: billData.template_id || 'default-1',
                    customer_id: billData.customer_id || null,
                    customer_name: billData.customer_name || '',
                    customer_phone: billData.customer_phone || '',
                    table_number: cleanTableNum,
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

                // Insert into target separated table ONLY (saved_bills OR print_bills)
                const keys = Object.keys(bill);
                const values = Object.values(bill);
                const placeholders = keys.map(() => '?').join(', ');
                
                await connection.query(
                    `INSERT INTO ${mainTable} (${keys.join(', ')}) VALUES (${placeholders})`,
                    values
                );

                // Insert bill items snapshot into target separated items table ONLY
                for (const item of billData.items) {
                    const itemData = {
                        id: uuidv4(),
                        bill_id: bill.id,
                        name: item.name,
                        barcode: item.barcode || null,
                        quantity: Number(item.quantity) || 1,
                        rate: Number(item.rate) || 0,
                        amount: (Number(item.quantity) || 1) * (Number(item.rate) || 0)
                    };
                    
                    const itemKeys = Object.keys(itemData);
                    const itemValues = Object.values(itemData);
                    const itemPlaceholders = itemKeys.map(() => '?').join(', ');
                    
                    await connection.query(
                        `INSERT INTO ${mainItemsTable} (${itemKeys.join(', ')}) VALUES (${itemPlaceholders})`,
                        itemValues
                    );
                }

                // Increment shop's invoice sequence safely
                const shopRows = await connection.query('SELECT invoice_sequence FROM shops WHERE user_id = ?', [billData.user_id]);
                const dbShopSeq = Number(shopRows[0]?.invoice_sequence || 1000);
                const nextShopSeq = Math.max(dbShopSeq + 1, currentSeq + 1);

                await connection.query(
                    `UPDATE shops SET invoice_sequence = ? WHERE user_id = ?`,
                    [nextShopSeq, billData.user_id]
                );

                await connection.commit();
                connection.release();

                insertedBillId = bill.id;
            } catch (err) {
                await connection.rollback();
                connection.release();

                const isDupNumber = err.message?.includes('bills_number_key') || 
                                   err.message?.includes('_user_number') || 
                                   err.message?.includes('bills.number') || 
                                   err.message?.includes('saved_bills.number') || 
                                   err.message?.includes('UNIQUE constraint failed') ||
                                   err.message?.includes('Duplicate entry');

                if (isDupNumber && retryCount < 25) {
                    currentSeq++;
                    billNumber = generateBillNumber(prefix, currentSeq, format);
                    continue;
                }
                throw err;
            }
        }

        // Fetch complete bill with items
        return await Bill.findById(insertedBillId);
    }

    static async findById(id) {
        let billData = await queryOne('SELECT * FROM saved_bills WHERE id = ?', [id]);
        let itemsTable = 'saved_bill_items';

        if (!billData) {
            billData = await queryOne('SELECT * FROM print_bills WHERE id = ?', [id]);
            itemsTable = 'print_bill_items';
        }

        if (!billData) {
            billData = await queryOne('SELECT * FROM bills WHERE id = ?', [id]);
            itemsTable = 'bill_items';
        }

        if (!billData) return null;

        const items = await query(`SELECT * FROM ${itemsTable} WHERE bill_id = ?`, [id]);
        return new Bill({ ...billData, items });
    }

    static async findByIdAndUser(id, userId) {
        let billData = await queryOne('SELECT * FROM saved_bills WHERE id = ? AND user_id = ?', [id, userId]);
        let itemsTable = 'saved_bill_items';

        if (!billData) {
            billData = await queryOne('SELECT * FROM print_bills WHERE id = ? AND user_id = ?', [id, userId]);
            itemsTable = 'print_bill_items';
        }

        if (!billData) {
            billData = await queryOne('SELECT * FROM bills WHERE id = ? AND user_id = ?', [id, userId]);
            itemsTable = 'bill_items';
        }

        if (!billData) return null;

        const items = await query(`SELECT * FROM ${itemsTable} WHERE bill_id = ?`, [id]);
        return new Bill({ ...billData, items });
    }

    static async findByUserId(userId, options = {}) {
        const { page, limit, search, payment_mode, daysLimit, is_saved } = options;

        let baseSql = '';
        let params = [];
        let itemsFetchMode = 'both';

        if (is_saved === true || is_saved === 'true' || is_saved === 1 || is_saved === '1') {
            baseSql = `FROM saved_bills WHERE user_id = ?`;
            params = [userId];
            itemsFetchMode = 'saved';
        } else if (is_saved === false || is_saved === 'false' || is_saved === 0 || is_saved === '0') {
            baseSql = `FROM print_bills WHERE user_id = ?`;
            params = [userId];
            itemsFetchMode = 'print';
        } else {
            baseSql = `FROM (
                SELECT id, user_id, template_id, customer_id, customer_name, customer_phone, table_number, number, discount, tax_rate, payment_mode, shop_name, shop_address, shop_phone, template_name, template_width, subtotal, tax_amount, total, created_at, 1 as is_saved FROM saved_bills WHERE user_id = ?
                UNION ALL
                SELECT id, user_id, template_id, customer_id, customer_name, customer_phone, table_number, number, discount, tax_rate, payment_mode, shop_name, shop_address, shop_phone, template_name, template_width, subtotal, tax_amount, total, created_at, 0 as is_saved FROM print_bills WHERE user_id = ?
            ) all_bills WHERE 1=1`;
            params = [userId, userId];
            itemsFetchMode = 'both';
        }

        if (daysLimit) {
            const daysNum = Number(daysLimit) || 10;
            const cutoffDate = new Date(Date.now() - daysNum * 24 * 60 * 60 * 1000).toISOString();
            baseSql += ` AND created_at >= ?`;
            params.push(cutoffDate);
        }

        if (search && search.trim()) {
            baseSql += ` AND (number LIKE ? OR customer_name LIKE ? OR customer_phone LIKE ?)`;
            const term = `%${search.trim()}%`;
            params.push(term, term, term);
        }

        if (payment_mode && payment_mode !== 'All') {
            baseSql += ` AND payment_mode = ?`;
            params.push(payment_mode);
        }

        const loadItemsForBills = async (billsList) => {
            if (!billsList || billsList.length === 0) return;
            const billIds = billsList.map(b => b.id);
            const placeholders = billIds.map(() => '?').join(',');

            let allItems = [];
            if (itemsFetchMode === 'saved') {
                allItems = await query(`SELECT * FROM saved_bill_items WHERE bill_id IN (${placeholders})`, billIds).catch(() => []);
            } else if (itemsFetchMode === 'print') {
                allItems = await query(`SELECT * FROM print_bill_items WHERE bill_id IN (${placeholders})`, billIds).catch(() => []);
            } else {
                const sItems = await query(`SELECT * FROM saved_bill_items WHERE bill_id IN (${placeholders})`, billIds).catch(() => []);
                const pItems = await query(`SELECT * FROM print_bill_items WHERE bill_id IN (${placeholders})`, billIds).catch(() => []);
                const bItems = await query(`SELECT * FROM bill_items WHERE bill_id IN (${placeholders})`, billIds).catch(() => []);
                allItems = [...(sItems || []), ...(pItems || []), ...(bItems || [])];
            }

            const itemsByBillId = {};
            for (const item of (allItems || [])) {
                if (!itemsByBillId[item.bill_id]) itemsByBillId[item.bill_id] = [];
                // Avoid duplicates if item exists in multiple tables
                if (!itemsByBillId[item.bill_id].some(existing => existing.id === item.id)) {
                    itemsByBillId[item.bill_id].push(item);
                }
            }
            for (const bill of billsList) {
                bill.items = itemsByBillId[bill.id] || [];
            }
        };

        // If pagination options are provided
        if (page !== undefined && limit !== undefined) {
            const countResult = await queryOne(`SELECT COUNT(*) as total ${baseSql}`, params);
            const total = Number(countResult?.total || 0);

            // page=abc, limit=-5 or limit=1000000 must not reach the database as they are
            const safeLimit = Math.min(200, Math.max(1, parseInt(limit, 10) || 20));
            const safePage = Math.max(1, parseInt(page, 10) || 1);
            const offset = (safePage - 1) * safeLimit;
            const queryParams = [...params, safeLimit, offset];
            const bills = await query(
                `SELECT * ${baseSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
                queryParams
            );

            await loadItemsForBills(bills);

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
        await loadItemsForBills(bills);
        return bills.map(b => new Bill(b));
    }

    /**
     * One day's sales for the History page: totals, payment split, top items and every bill's time
     * (the app groups those by its own local hour). fromIso/toIso: the shop's local day in UTC.
     */
    static async getDayAnalytics(userId, fromIso, toIso) {
        const bills = await query(
            `SELECT id, total, discount, payment_mode, created_at, 'saved' AS kind FROM saved_bills WHERE user_id = ? AND created_at >= ? AND created_at < ?
             UNION ALL
             SELECT id, total, discount, payment_mode, created_at, 'printed' AS kind FROM print_bills WHERE user_id = ? AND created_at >= ? AND created_at < ?`,
            [userId, fromIso, toIso, userId, fromIso, toIso]
        ).catch(() => []);

        const items = await query(
            `SELECT LOWER(TRIM(i.name)) AS k, MIN(i.name) AS name, SUM(i.quantity) AS qty, SUM(i.amount) AS amount
             FROM (
                SELECT si.name, si.quantity, si.amount FROM saved_bill_items si JOIN saved_bills b ON b.id = si.bill_id
                    WHERE b.user_id = ? AND b.created_at >= ? AND b.created_at < ?
                UNION ALL
                SELECT pi.name, pi.quantity, pi.amount FROM print_bill_items pi JOIN print_bills b ON b.id = pi.bill_id
                    WHERE b.user_id = ? AND b.created_at >= ? AND b.created_at < ?
             ) i
             GROUP BY LOWER(TRIM(i.name))
             ORDER BY SUM(i.amount) DESC`,
            [userId, fromIso, toIso, userId, fromIso, toIso]
        ).catch(() => []);

        const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
        const list = bills || [];
        const total = list.reduce((s, b) => s + Number(b.total || 0), 0);
        const of = (kind) => list.filter((b) => b.kind === kind);
        const modes = new Map();
        for (const b of list) {
            const raw = String(b.payment_mode || 'Cash').trim();
            const mode = /upi|gpay|phonepe|paytm/i.test(raw) ? 'UPI' : /card/i.test(raw) ? 'Card' : /cash/i.test(raw) || !raw ? 'Cash' : raw;
            const m = modes.get(mode) || { mode, count: 0, total: 0 };
            m.count++; m.total += Number(b.total || 0);
            modes.set(mode, m);
        }
        const itemRows = (items || []).map((it) => ({ name: it.name, qty: r2(it.qty), amount: r2(it.amount) }));
        return {
            from: fromIso,
            to: toIso,
            total_sales: r2(total),
            bill_count: list.length,
            avg_bill: list.length ? r2(total / list.length) : 0,
            printed: { count: of('printed').length, total: r2(of('printed').reduce((s, b) => s + Number(b.total || 0), 0)) },
            saved: { count: of('saved').length, total: r2(of('saved').reduce((s, b) => s + Number(b.total || 0), 0)) },
            discount_total: r2(list.reduce((s, b) => s + Number(b.discount || 0), 0)),
            items_sold: r2(itemRows.reduce((s, it) => s + it.qty, 0)),
            payment_modes: [...modes.values()].map((m) => ({ ...m, total: r2(m.total) })).sort((a, b) => b.total - a.total),
            top_items: itemRows.slice(0, 5),
            bills: list.map((b) => ({ total: r2(b.total), created_at: b.created_at }))
        };
    }

    static async getTodaySales(userId) {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const res = await queryOne(
            `SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as total FROM (
                SELECT total, user_id, created_at FROM saved_bills WHERE user_id = ?
                UNION ALL
                SELECT total, user_id, created_at FROM print_bills WHERE user_id = ?
            ) all_today WHERE created_at >= ?`,
            [userId, userId, todayStart.toISOString()]
        );
        return {
            count: Number(res?.count || 0),
            total: Number(res?.total || 0)
        };
    }

    static async markAsPrinted(id, userId) {
        if (!id || !userId) return false;
        const connection = await beginTransaction();
        let tableToReset = null;
        try {
            // Check if bill exists in saved_bills
            const savedRows = await connection.query(
                'SELECT * FROM saved_bills WHERE id = ? AND user_id = ?',
                [id, userId]
            );

            if (savedRows && savedRows.length > 0) {
                const bill = savedRows[0];
                tableToReset = bill.table_number || bill.table;

                // Check if already in print_bills
                const existingPrint = await connection.query(
                    'SELECT id FROM print_bills WHERE id = ?',
                    [id]
                );

                if (!existingPrint || existingPrint.length === 0) {
                    const keys = Object.keys(bill);
                    const values = Object.values(bill);
                    const placeholders = keys.map(() => '?').join(', ');
                    await connection.query(
                        `INSERT INTO print_bills (${keys.join(', ')}) VALUES (${placeholders})`,
                        values
                    );

                    // Move items
                    const items = await connection.query(
                        'SELECT * FROM saved_bill_items WHERE bill_id = ?',
                        [id]
                    );
                    for (const item of (items || [])) {
                        const itemKeys = Object.keys(item);
                        const itemValues = Object.values(item);
                        const itemPlaceholders = itemKeys.map(() => '?').join(', ');
                        await connection.query(
                            `INSERT INTO print_bill_items (${itemKeys.join(', ')}) VALUES (${itemPlaceholders})`,
                            itemValues
                        ).catch(() => {});
                    }
                }

                // Delete from saved_bills and saved_bill_items
                await connection.query('DELETE FROM saved_bill_items WHERE bill_id = ?', [id]);
                await connection.query('DELETE FROM saved_bills WHERE id = ? AND user_id = ?', [id, userId]);
            }

            // Also check bills table if table_number was saved there
            if (!tableToReset) {
                const billRows = await connection.query('SELECT table_number FROM bills WHERE id = ? AND user_id = ?', [id, userId]).catch(() => []);
                if (billRows && billRows.length > 0 && billRows[0].table_number) {
                    tableToReset = billRows[0].table_number;
                }
            }

            // Also update bills table if it exists
            await connection.query('UPDATE bills SET is_saved = 0 WHERE id = ? AND user_id = ?', [id, userId]).catch(() => {});

            await connection.commit();
            connection.release();

            // Reset table to AVAILABLE
            if (tableToReset) {
                try {
                    await RestaurantTable.resetTable(userId, tableToReset);
                } catch (tErr) {
                    console.warn(`Could not reset table ${tableToReset} on bill print:`, tErr);
                }
            }

            return true;
        } catch (err) {
            await connection.rollback();
            connection.release();
            throw err;
        }
    }

    static async markTableAsPrinted(tableIdentifier, userId) {
        if (!tableIdentifier || !userId) return 0;
        const cleanTable = String(tableIdentifier).trim();
        const savedRows = await query(
            'SELECT id FROM saved_bills WHERE user_id = ? AND (table_number = ? OR table_number = ?)',
            [userId, cleanTable, `Table ${cleanTable}`]
        );
        let count = 0;
        for (const row of (savedRows || [])) {
            await this.markAsPrinted(row.id, userId);
            count++;
        }
        try {
            await RestaurantTable.resetTable(userId, cleanTable);
        } catch (_) {}
        return count;
    }

    static async update(id, userId, billData) {
        let bill = await queryOne('SELECT * FROM saved_bills WHERE id = ? AND user_id = ?', [id, userId]);
        let isSavedBills = true;

        if (!bill) {
            bill = await queryOne('SELECT * FROM bills WHERE id = ? AND user_id = ? AND is_saved = 1', [id, userId]);
            isSavedBills = false;
        }

        if (!bill) {
            throw Object.assign(new Error('Saved bill not found or cannot be edited. Only saved bills can be edited.'), { statusCode: 404 });
        }

        const totals = calculateBillTotals(billData.items, billData.discount, billData.tax_rate);

        const connection = await beginTransaction();
        try {
            const rawTableNum = billData.table_number || billData.table || billData.table_name || '';
            const cleanTableNum = rawTableNum ? String(rawTableNum).trim() : null;

            await connection.query(
                `UPDATE saved_bills SET 
                    customer_name = ?, 
                    customer_phone = ?, 
                    table_number = ?, 
                    discount = ?, 
                    tax_rate = ?, 
                    payment_mode = ?, 
                    template_id = ?, 
                    template_name = ?, 
                    template_width = ?, 
                    subtotal = ?, 
                    tax_amount = ?, 
                    total = ?
                WHERE id = ? AND user_id = ?`,
                [
                    billData.customer_name || '',
                    billData.customer_phone || '',
                    cleanTableNum,
                    Number(billData.discount) || 0,
                    Number(billData.tax_rate) || 0,
                    billData.payment_mode || 'Cash',
                    billData.template_id || bill.template_id || 'default-1',
                    billData.template_name || bill.template_name || '',
                    billData.template_width || bill.template_width || '58mm',
                    totals.subtotal,
                    totals.tax_amount,
                    totals.total,
                    id,
                    userId
                ]
            ).catch(() => {});

            // Delete old saved items
            await connection.query('DELETE FROM saved_bill_items WHERE bill_id = ?', [id]).catch(() => {});

            // Insert updated saved items
            for (const item of billData.items) {
                const itemData = {
                    id: uuidv4(),
                    bill_id: id,
                    name: item.name,
                    barcode: item.barcode || null,
                    quantity: Number(item.quantity) || 1,
                    rate: Number(item.rate) || 0,
                    amount: (Number(item.quantity) || 1) * (Number(item.rate) || 0)
                };

                const itemKeys = Object.keys(itemData);
                const itemValues = Object.values(itemData);
                const itemPlaceholders = itemKeys.map(() => '?').join(', ');

                await connection.query(
                    `INSERT INTO saved_bill_items (${itemKeys.join(', ')}) VALUES (${itemPlaceholders})`,
                    itemValues
                ).catch(() => {});
            }

            // Also keep bills / bill_items in sync if present
            await connection.query(
                `UPDATE bills SET 
                    customer_name = ?, 
                    customer_phone = ?, 
                    table_number = ?, 
                    discount = ?, 
                    tax_rate = ?, 
                    payment_mode = ?, 
                    template_id = ?, 
                    template_name = ?, 
                    template_width = ?, 
                    subtotal = ?, 
                    tax_amount = ?, 
                    total = ?
                WHERE id = ? AND user_id = ?`,
                [
                    billData.customer_name || '',
                    billData.customer_phone || '',
                    cleanTableNum,
                    Number(billData.discount) || 0,
                    Number(billData.tax_rate) || 0,
                    billData.payment_mode || 'Cash',
                    billData.template_id || bill.template_id || 'default-1',
                    billData.template_name || bill.template_name || '',
                    billData.template_width || bill.template_width || '58mm',
                    totals.subtotal,
                    totals.tax_amount,
                    totals.total,
                    id,
                    userId
                ]
            ).catch(() => {});

            await connection.commit();
            connection.release();

            return await Bill.findByIdAndUser(id, userId);
        } catch (err) {
            await connection.rollback();
            connection.release();
            throw err;
        }
    }

    static async delete(id, userId) {
        const connection = await beginTransaction();
        try {
            // Items are only removed when the bill itself belongs to this user
            let removed = 0;
            for (const [itemsTable, billsTable] of [
                ['saved_bill_items', 'saved_bills'],
                ['print_bill_items', 'print_bills'],
                ['bill_items', 'bills']
            ]) {
                await connection.query(
                    `DELETE FROM ${itemsTable} WHERE bill_id = ? AND bill_id IN (SELECT id FROM ${billsTable} WHERE id = ? AND user_id = ?)`,
                    [id, id, userId]
                );
                const res = await connection.query(`DELETE FROM ${billsTable} WHERE id = ? AND user_id = ?`, [id, userId]);
                removed += Number(res?.affectedRows || 0);
            }

            await connection.commit();
            connection.release();
            return removed > 0;
        } catch (err) {
            await connection.rollback();
            connection.release();
            throw err;
        }
    }
}