import Bill from '../models/Bill.js';
import { query, beginTransaction } from '../config/database.js';
import { normalizeUnit, roundQty } from '../utils/units.js';
import { normalizeGstRate } from '../utils/gst.js';
import Shop from '../models/Shop.js';
import Template from '../models/Template.js';
import Subscription from '../models/Subscription.js';
import RestaurantTable from '../models/RestaurantTable.js';
import TableBill from '../models/TableBill.js';
import Inventory, { isInventoryType } from '../models/Inventory.js';
import Notification from '../models/Notification.js';
import PrintLock, { billKey, tableKey, cleanHolder } from '../models/PrintLock.js';

const badRequest = (message) => Object.assign(new Error(message), { statusCode: 400 });

// One thing at a time for a restaurant table (two phones saving the same order): the second waits for the first
// Only a few at once: each keeps a database connection while its work needs another, and must never use them all up.
const MAX_TABLE_LOCKS = 3;
let tableLocks = 0;
const tableQueue = [];
const withTableLock = async (tableId, work) => {
    if (tableLocks >= MAX_TABLE_LOCKS) await new Promise((resolve) => tableQueue.push(resolve));
    else tableLocks++;
    try {
        return await lockTable(tableId, work);
    } finally {
        const next = tableQueue.shift();
        if (next) next(); // takes this place over
        else tableLocks--;
    }
};
const lockTable = async (tableId, work) => {
    const tx = await beginTransaction();
    try {
        await tx.query('UPDATE restaurant_tables SET status = status WHERE id = ?', [tableId]);
        const result = await work();
        await tx.commit();
        return result;
    } catch (err) {
        await tx.rollback();
        throw err;
    } finally {
        tx.release();
    }
};

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
        const newBill = {
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
        };
        // The order on a restaurant table is one bill, whoever of the shop saves or prints it
        const orderTable = req.body.table_order === true && is_saved ? await RestaurantTable.find(req.user.id, newBill.table_number) : null;
        const holder = cleanHolder(req.body.holder);
        let bill = null;
        if (orderTable) {
            const outcome = await withTableLock(orderTable.id, async () => {
                const openId = await TableBill.find(req.user.id, orderTable.id);
                if (openId) {
                    const busy = await PrintLock.busyElsewhere(req.user.id, billKey(openId), holder);
                    if (busy) return { busy };
                    // printed a moment ago elsewhere: it is no longer waiting, so this is a new bill
                    if (!(await Bill.isPrinted(openId, req.user.id))) return { bill: await Bill.update(openId, req.user.id, newBill) };
                }
                const created = await Bill.create(newBill);
                await TableBill.set(req.user.id, orderTable.id, created.id);
                return { bill: created };
            });
            if (outcome.busy) {
                return res.status(409).json({ code: 'PRINTING_ELSEWHERE', detail: 'This is being printed on another device right now. Please wait a moment.', device: outcome.busy.device || '' });
            }
            bill = outcome.bill;
        } else {
            bill = await Bill.create(newBill);
        }

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
        if (orderTable) responseData.table_linked = true;
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

        // The same bill can be open on another device: it must not change while that device prints it, nor after
        // that device printed it (the paper would no longer match)
        const holder = cleanHolder(req.body.holder);
        const printedBefore = await Bill.isPrinted(id, req.user.id).catch(() => false);
        if (holder) {
            const lock = await PrintLock.info(req.user.id, billKey(id));
            if (lock?.live && lock.holder !== holder) {
                return res.status(409).json({ code: 'PRINTING_ELSEWHERE', detail: 'This is being printed on another device right now. Please wait a moment.', device: lock.device || '' });
            }
            if (printedBefore && req.body.is_saved && lock?.printed_at && lock.printed_holder !== holder) {
                return res.status(409).json({ code: 'ALREADY_PRINTED', detail: 'This bill was already printed on another device, so it cannot be changed.', device: lock.printed_device || '', printed_at: lock.printed_at });
            }
        }
        const shop = await Shop.findByUserId(req.user.id).catch(() => null);

        // what this bill already took out of stock counts as available again
        await Inventory.checkBill(req.user.id, normalizedItems, id, shop);

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

        // the bill of the order on a table: the shop's other devices save and print this same bill
        if (req.body.table_order === true && cleanTableNum && !printedBefore) {
            const orderTable = await RestaurantTable.find(req.user.id, cleanTableNum);
            if (orderTable) {
                await TableBill.set(req.user.id, orderTable.id, id).catch((e) => console.warn('⚠️ Table bill:', e.message));
                if (updated) updated.table_linked = true;
            }
        }

        // Only sync stock if the bill was ALREADY printed.
        // If it's still a saved bill waiting to print, do NOT deduct stock before printing!
        if (printedBefore && isInventoryType(shop?.business_type)) {
            await Inventory.syncBill(req.user.id, id, normalizedItems, updated?.number, shop).catch((e) => console.warn('⚠️ Stock update for bill:', e.message));
        }

        res.json(updated);
    } catch (err) {
        if (err.message && err.message.includes('not found')) {
            return res.status(404).json({ detail: err.message, code: 'BILL_GONE' });
        }
        if (err.statusCode) {
            return res.status(err.statusCode).json({ detail: err.message });
        }
        next(err);
    }
};

/**
 * POST /bills/print-claim { holder, device, bill_id | table }
 * Called by a device right before it prints. Refused (409 / 403) when another device is printing the same bill or
 * table, when the last print credits are in use, or when the goods were just sold on another device.
 */
export const claimPrint = async (req, res, next) => {
    try {
        const holder = cleanHolder(req.body?.holder);
        const { bill_id: billId, table } = req.body || {};
        if (!holder || (!billId && !table)) return res.status(400).json({ detail: 'holder and bill_id or table are required' });
        const device = req.body.device;

        if (table) {
            const result = await PrintLock.claim(req.user.id, tableKey(table), { holder, device });
            return result.ok ? res.json({ ok: true }) : res.status(result.status).json(result.body);
        }

        const bill = await Bill.findByIdAndUser(billId, req.user.id);
        if (!bill) return res.status(404).json({ code: 'BILL_GONE', detail: 'Bill not found' });
        const [printed, quota, shop] = await Promise.all([
            Bill.isPrinted(billId, req.user.id),
            Subscription.getQuotaByUserId(req.user.id),
            Shop.findByUserId(req.user.id).catch(() => null)
        ]);
        // a bill that has not printed yet takes its items out of stock when it prints
        const stock = !printed && isInventoryType(shop?.business_type) ? await Inventory.needsFor(req.user.id, bill.items) : [];
        const result = await PrintLock.claim(req.user.id, billKey(billId), { holder, device, credit: req.body.credit !== false, quota, stock });
        if (!result.ok) return res.status(result.status).json(result.body);

        // read again after the claim: another device may have finished printing it a moment ago
        const printedNow = printed || await Bill.isPrinted(billId, req.user.id);
        const elsewhere = printedNow && result.printed && result.printed.holder !== holder ? result.printed : null;
        res.json({ ok: true, printed: printedNow, printed_elsewhere: elsewhere ? { device: elsewhere.device, at: elsewhere.at } : null, quota });
    } catch (err) {
        next(err);
    }
};

/** POST /bills/print-release { holder, bill_id | table }: the print was cancelled or failed */
export const releasePrint = async (req, res) => {
    const holder = cleanHolder(req.body?.holder);
    const { bill_id: billId, table } = req.body || {};
    if (holder && billId) await PrintLock.release(req.user.id, billKey(billId), holder);
    if (holder && table) await PrintLock.release(req.user.id, tableKey(table), holder);
    res.json({ ok: true });
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

        const late = req.body?.late === true;
        const { moved } = (await Bill.markAsPrinted(id, req.user.id, { late })) || {};
        const holder = cleanHolder(req.body?.holder);
        if (holder) await PrintLock.release(req.user.id, billKey(id), holder, { printed: true, device: req.body?.device });

        // only the first print frees the table: a later copy must not clear the next customers' order
        if (tableNum && moved) {
            try {
                await Bill.clearTableOf(req.user.id, tableNum, id, { late });
            } catch (e) {}
        }

        // Receipt is printed: deduct stock now for inventory shops! Once per bill: a copy, or the same print reported by
        // a second device, takes nothing more out
        const shop = moved ? await Shop.findByUserId(req.user.id).catch(() => null) : null;
        if (moved && isInventoryType(shop?.business_type)) {
            const billItems = Array.isArray(bill.items) ? bill.items : (typeof bill.items === 'string' ? JSON.parse(bill.items || '[]') : []);
            await Inventory.syncBill(req.user.id, bill.id, billItems, bill.number, shop).catch((e) => console.warn('⚠️ Stock deduction on print:', e.message));
            await Notification.afterSale(req.user.id);
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
        const busy = await PrintLock.busyElsewhere(req.user.id, billKey(id), cleanHolder(req.query.holder));
        if (busy) {
            return res.status(409).json({ code: 'PRINTING_ELSEWHERE', detail: 'This is being printed on another device right now. Please wait a moment.', device: busy.device || '' });
        }
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