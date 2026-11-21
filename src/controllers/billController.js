import Bill from '../models/Bill.js';
import { query } from '../config/database.js';
import { normalizeUnit, roundQty } from '../utils/units.js';
import { normalizeGstRate } from '../utils/gst.js';
import Shop from '../models/Shop.js';
import Template from '../models/Template.js';
import Subscription from '../models/Subscription.js';
import RestaurantTable from '../models/RestaurantTable.js';
import Inventory, { isInventoryType } from '../models/Inventory.js';

const badRequest = (message) => Object.assign(new Error(message), { statusCode: 400 });

export const getBills = async (req, res, next) => {
    try {
        const { page, limit, search, payment_mode, days_limit, from, is_saved, saved_only } = req.query;
        const options = {};
        if (page !== undefined && limit !== undefined) {
            options.page = page;
            options.limit = limit;
        }
        if (search) options.search = search;
        if (payment_mode) options.payment_mode = payment_mode;
        if (days_limit) options.daysLimit = days_limit;
        // from=<ISO of the shop's local midnight>: only bills made since then (the History page shows today only).
        // Same rule as the analytics: a midnight within the last day is accepted, anything else is ignored.
        if (from) {
            const fromDate = new Date(String(from));
            const now = Date.now();
            if (!Number.isNaN(fromDate.getTime()) && fromDate.getTime() <= now && now - fromDate.getTime() <= 25 * 60 * 60 * 1000) {
                options.fromDate = fromDate.toISOString();
            }
        }
        if (is_saved !== undefined) options.is_saved = is_saved === 'true' || is_saved === '1' || is_saved === true;
        if (saved_only !== undefined) options.is_saved = saved_only === 'true' || saved_only === '1' || saved_only === true;

        const result = await Bill.findByUserId(req.user.id, options);
        res.json(result);
    } catch (err) {
        next(err);
    }
};

export const createBill = async (req, res, next) => {
    try {
        const {
            template_id,
            items,
            discount,
            tax_rate,
            payment_mode,
            customer_id,
            customer_name,
            customer_phone,
            number,
            template_name,
            template_width,
            table_number,
            table,
            table_name,
            tableId,
            table_id,
            is_saved
        } = req.body;
        
        // Validate items with proper checks
        if (!items || !items.length) {
            return res.status(400).json({ 
                detail: 'At least one item is required' 
            });
        }

        // Validate and normalize items
        const normalizedItems = items.map((item, index) => {
            const name = String(item.name || '').trim();
            const quantity = Number(item.quantity);
            const rate = Number(item.rate);

            if (!name) {
                throw badRequest(`Item ${index + 1}: Name is required`);
            }

            if (!Number.isFinite(quantity) || quantity <= 0) {
                throw badRequest(`Item ${index + 1}: Quantity must be more than 0`);
            }

            if (!Number.isFinite(rate) || rate < 0) {
                throw badRequest(`Item ${index + 1}: Rate cannot be negative`);
            }

            const barcode = item.barcode ? String(item.barcode).trim() : null;

            return { name, quantity: roundQty(quantity), rate, barcode, unit: normalizeUnit(item.unit), gst_rate: normalizeGstRate(item.gst_rate) };
        });
        
        // Get shop: auto-create default if not found
        let shop = await Shop.findByUserId(req.user.id);
        if (!shop) {
            shop = await Shop.create({
                user_id: req.user.id,
                name: `${req.user.name || 'My'} Shop`,
                phone: '',
                address: ''
            });
        }
        
        // Get template: use provided template metadata or default fallback
        let template = {
            id: template_id || 'default-1',
            name: template_name || 'Classic Receipt',
            width: template_width || '58mm'
        };
        // Only lookup custom templates in database if template_name is not provided and id is a custom uuid
        if (!template_name && template_id && template_id.length > 10) {
            const dbTemplate = await Template.findById(template_id) || await Template.findByIdAndUser(template_id, req.user.id);
            if (dbTemplate) {
                template = dbTemplate;
            }
        }
        
        // kirana / cloth shops: no bill for more than is in stock
        if (isInventoryType(shop?.business_type)) {
            await Inventory.checkBill(req.user.id, normalizedItems, null, shop);
        }

        // Create bill with transaction
        const bill = await Bill.create({
            user_id: req.user.id,
            template_id: template.id,
            customer_id: customer_id || null,
            customer_name: customer_name?.trim() || '',
            customer_phone: customer_phone?.trim() || '',
            table_number: table_number || table || table_name || tableId || table_id || '',
            number: number?.trim() || '',
            items: normalizedItems,
            discount: Number(discount) || 0,
            tax_rate: Number(tax_rate) || 0,
            payment_mode: payment_mode || 'Cash',
            shop_name: shop.name,
            shop_address: shop.address,
            shop_phone: shop.phone,
            template_name: template.name || template_name || '',
            template_width: template.width || template_width || '58mm',
            is_saved: is_saved,
            shop
        });

        // Only deduct stock if bill is directly printed (!is_saved).
        // Before printing the receipt, do NOT deduct the stock!
        const isSaved = is_saved === true || is_saved === 'true' || is_saved === 1 || is_saved === '1';
        if (!isSaved && isInventoryType(shop?.business_type)) {
            Inventory.syncBill(req.user.id, bill?.id, normalizedItems, bill?.number, shop).catch((e) => console.warn('⚠️ Stock update for bill:', e.message));
        }

        const rawTableId = table_number || table || table_name || '';
        if (!is_saved && rawTableId) {
            RestaurantTable.resetTable(req.user.id, rawTableId).catch(() => {});
        }

        // Return bill object augmented with quota if print bill
        const responseData = typeof bill.toJSON === 'function' ? bill.toJSON() : { ...bill };
        if (!is_saved) {
            responseData.quota = await Subscription.getQuotaByUserId(req.user.id).catch(() => null);
        }
        
        res.status(201).json(responseData);
    } catch (err) {
        if (err.statusCode) {
            return res.status(err.statusCode).json({ detail: err.message });
        }
        next(err);
    }
};

export const getBill = async (req, res) => {
    const { id } = req.params;
    const bill = await Bill.findByIdAndUser(id, req.user.id);
    
    if (!bill) {
        return res.status(404).json({ detail: 'Bill not found' });
    }
    
    res.json(bill);
};

export const updateBill = async (req, res, next) => {
    try {
        const { id } = req.params;
        const {
            template_id,
            items,
            discount,
            tax_rate,
            payment_mode,
            customer_name,
            customer_phone,
            template_name,
            template_width,
            table_number,
            table,
            table_name
        } = req.body;

        if (!items || !items.length) {
            return res.status(400).json({ detail: 'At least one item is required' });
        }

        const normalizedItems = items.map((item, index) => {
            const name = String(item.name || '').trim();
            const quantity = Number(item.quantity);
            const rate = Number(item.rate);

            if (!name) throw badRequest(`Item ${index + 1}: Name is required`);
            if (!Number.isFinite(quantity) || quantity <= 0) throw badRequest(`Item ${index + 1}: Quantity must be more than 0`);
            if (!Number.isFinite(rate) || rate < 0) throw badRequest(`Item ${index + 1}: Rate cannot be negative`);

            return { name, quantity: roundQty(quantity), rate, barcode: item.barcode || null, unit: normalizeUnit(item.unit), gst_rate: normalizeGstRate(item.gst_rate) };
        });

        // what this bill already took out of stock counts as available again
        await Inventory.checkBill(req.user.id, normalizedItems, id);

        const rawTableNum = table_number || table || table_name || '';
        const cleanTableNum = rawTableNum ? String(rawTableNum).trim() : null;

        const updated = await Bill.update(id, req.user.id, {
            template_id,
            template_name,
            template_width,
            customer_name: customer_name?.trim() || '',
            customer_phone: customer_phone?.trim() || '',
            table_number: cleanTableNum,
            discount: Number(discount) || 0,
            tax_rate: Number(tax_rate) || 0,
            payment_mode: payment_mode || 'Cash',
            items: normalizedItems
        });

        const currentBill = await Bill.findByIdAndUser(id, req.user.id).catch(() => null);
        const wasSaved = currentBill?.is_saved === 1 || currentBill?.is_saved === true;
        // Only sync stock if the bill was ALREADY printed (is_saved === 0).
        // If it's still a saved bill waiting to print, do NOT deduct stock before printing!
        if (!wasSaved && isInventoryType(shop?.business_type)) {
            await Inventory.syncBill(req.user.id, id, normalizedItems, updated?.number).catch((e) => console.warn('⚠️ Stock update for bill:', e.message));
        }

        res.json(updated);
    } catch (err) {
        if (err.message && err.message.includes('not found')) {
            return res.status(404).json({ detail: err.message });
        }
        next(err);
    }
};

export const getBillStats = async (req, res) => {
    const stats = await Bill.getTodaySales(req.user.id);
    res.json(stats);
};

/**
 * GET /api/bills/analytics/today?from=<ISO of the shop's local midnight>
 * Today's sales (the day resets at the shop's midnight) plus yesterday's totals to compare.
 */
export const getTodayAnalytics = async (req, res, next) => {
    try {
        const DAY = 24 * 60 * 60 * 1000;
        const now = Date.now();
        let from = new Date(String(req.query.from || ''));
        // only a midnight within the last day is accepted; otherwise the server's own midnight
        if (Number.isNaN(from.getTime()) || from.getTime() > now || now - from.getTime() > DAY + 60 * 60 * 1000) {
            from = new Date();
            from.setHours(0, 0, 0, 0);
        }
        const to = new Date(from.getTime() + DAY);
        const yFrom = new Date(from.getTime() - DAY);
        const [today, yesterday] = await Promise.all([
            Bill.getDayAnalytics(req.user.id, from.toISOString(), to.toISOString(), { includeItems: true }),
            Bill.getDayAnalytics(req.user.id, yFrom.toISOString(), from.toISOString(), { includeItems: false })
        ]);
        res.json({ ...today, yesterday: { total_sales: yesterday.total_sales, bill_count: yesterday.bill_count, avg_bill: yesterday.avg_bill } });
    } catch (err) {
        next(err);
    }
};

export const markBillAsPrinted = async (req, res, next) => {
    try {
        const { id } = req.params;
        const bill = await Bill.findByIdAndUser(id, req.user.id);
        if (!bill) {
            return res.status(404).json({ detail: 'Bill not found' });
        }
        const tableNum = bill?.table_number || bill?.table;

        await Bill.markAsPrinted(id, req.user.id);

        if (tableNum) {
            try {
                await RestaurantTable.resetTable(req.user.id, tableNum);
            } catch (e) {}
        }

        // Receipt is printed: deduct stock now for inventory shops!
        const shop = await Shop.findByUserId(req.user.id).catch(() => null);
        if (isInventoryType(shop?.business_type)) {
            const billItems = Array.isArray(bill.items) ? bill.items : (typeof bill.items === 'string' ? JSON.parse(bill.items || '[]') : []);
            await Inventory.syncBill(req.user.id, bill.id, billItems, bill.number, shop).catch((e) => console.warn('⚠️ Stock deduction on print:', e.message));
        }

        res.json({ message: 'Bill marked as printed', success: true, id, table_number: tableNum });
    } catch (err) {
        next(err);
    }
};

export const markTableBillsAsPrinted = async (req, res, next) => {
    try {
        const { tableNumber } = req.params;
        const cleanTable = String(tableNumber || '').trim();
        // Fetch saved bills for table before markAsPrinted moves them from saved_bills
        const savedRows = await query(
            'SELECT id, number, items FROM saved_bills WHERE user_id = ? AND (table_number = ? OR table_number = ?)',
            [req.user.id, cleanTable, `Table ${cleanTable}`]
        ).catch(() => []);

        const count = await Bill.markTableAsPrinted(tableNumber, req.user.id);
        if (tableNumber) {
            try {
                await RestaurantTable.resetTable(req.user.id, tableNumber);
            } catch (e) {}
        }

        // Receipt is printed: deduct stock for these table bills
        const shop = await Shop.findByUserId(req.user.id).catch(() => null);
        if (isInventoryType(shop?.business_type) && Array.isArray(savedRows)) {
            for (const r of savedRows) {
                const billItems = Array.isArray(r.items) ? r.items : (typeof r.items === 'string' ? JSON.parse(r.items || '[]') : []);
                await Inventory.syncBill(req.user.id, r.id, billItems, r.number, shop).catch((e) => console.warn('⚠️ Stock update for table bill print:', e.message));
            }
        }

        res.json({ message: 'Table bills marked as printed', success: true, count, table_number: tableNumber });
    } catch (err) {
        next(err);
    }
};

export const deleteBill = async (req, res, next) => {
    try {
        const { id } = req.params;
        const deleted = await Bill.delete(id, req.user.id);
        
        if (!deleted) {
            return res.status(404).json({ detail: 'Bill not found or unauthorized' });
        }
        await Inventory.reverseBill(req.user.id, id).catch((e) => console.warn('⚠️ Stock restore for bill:', e.message));
        
        res.json({ message: 'Bill deleted successfully', id });
    } catch (err) {
        next(err);
    }
};