import { v4 as uuidv4 } from 'uuid';
import { query, queryOne, insert } from '../config/database.js';
import Shop from './Shop.js';
import UserMenuItem from './UserMenuItem.js';

// Stock is kept for these shop types only (they sell counted goods; cafes and restaurants do not)
const INVENTORY_TYPES = ['kirana_grocery', 'clothing_garments'];
export const isInventoryType = (type) => {
    const t = String(type || '').toLowerCase();
    return INVENTORY_TYPES.includes(t) || t.includes('kirana') || t.includes('grocery') || t.includes('cloth') || t.includes('garment');
};

const REASONS = ['opening', 'restock', 'sale', 'sale_return', 'damage', 'correction', 'adjust'];
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const round2 = (n) => Math.round(Number(n) * 100) / 100;
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });

async function currentStock(userId, itemId) {
    const row = await queryOne('SELECT stock_qty FROM user_menu_items WHERE id = ? AND user_id = ?', [itemId, userId]);
    return row ? Number(row.stock_qty || 0) : null;
}

// Adds `change` (may be negative) to an item's stock in one statement and records it
async function applyChange(userId, itemId, change, reason, { billId = null, note = null } = {}) {
    await query(
        'UPDATE user_menu_items SET stock_qty = COALESCE(stock_qty, 0) + ?, track_stock = ?, updated_at = ? WHERE id = ? AND user_id = ?',
        [change, true, new Date().toISOString(), itemId, userId]
    );
    const balance = await currentStock(userId, itemId);
    await insert('stock_movements', {
        id: uuidv4(),
        user_id: userId,
        user_menu_item_id: itemId,
        change,
        balance_after: balance,
        reason,
        bill_id: billId,
        note: note ? String(note).slice(0, 200) : null,
        created_at: new Date().toISOString()
    });
    return balance;
}

// Adds up a bill's quantities per tracked menu item (matched by barcode, then by name)
async function trackedTotals(userId, items) {
    const tracked = (await UserMenuItem.findByUserId(userId, '', 'all', '')).filter((it) => it.track_stock);
    const totals = new Map();
    if (!tracked.length) return totals;
    const byBarcode = new Map();
    const byName = new Map();
    tracked.forEach((it) => {
        if (it.barcode) byBarcode.set(String(it.barcode).trim().toLowerCase(), it);
        byName.set(String(it.name || '').trim().toLowerCase(), it);
    });
    for (const line of items || []) {
        const code = line.barcode ? String(line.barcode).trim().toLowerCase() : '';
        const match = (code && byBarcode.get(code)) || byName.get(String(line.name || '').trim().toLowerCase());
        if (!match) continue;
        const cur = totals.get(match.id) || { item: match, qty: 0 };
        cur.qty += Number(line.quantity || 0);
        totals.set(match.id, cur);
    }
    return totals;
}

export default class Inventory {
    /**
     * Refuses a bill that asks for more than is in stock. For an edited bill, what that bill already took
     * out counts as available again. Throws a 400 error naming the first item that is short.
     */
    static async checkBill(userId, items, billId = null) {
        const shop = await Shop.findByUserId(userId);
        if (!isInventoryType(shop?.business_type)) return;
        const totals = await trackedTotals(userId, items);
        if (!totals.size) return;

        const alreadyTaken = new Map();
        if (billId) {
            const rows = await query(
                "SELECT user_menu_item_id, change FROM stock_movements WHERE user_id = ? AND bill_id = ? AND reason = 'sale'",
                [userId, billId]
            ).catch(() => []);
            for (const r of rows || []) {
                alreadyTaken.set(r.user_menu_item_id, (alreadyTaken.get(r.user_menu_item_id) || 0) - Number(r.change || 0));
            }
        }
        for (const [itemId, { item, qty }] of totals) {
            const available = Number(item.stock_qty || 0) + (alreadyTaken.get(itemId) || 0);
            if (qty > available) {
                const left = Math.max(0, round2(available));
                throw fail(left <= 0
                    ? `"${item.name}" is out of stock`
                    : `Only ${left} of "${item.name}" left in stock`);
            }
        }
    }

    /** Manual stock change from the Menu page: { change: +5 / -2 } or { set: 40 } */
    static async adjust(userId, itemId, { change, set, reason, note } = {}) {
        const item = await UserMenuItem.findByIdAndUser(itemId, userId);
        if (!item) return null;

        let delta
        if (set !== undefined && set !== null && set !== '') {
            const target = num(set);
            if (!Number.isFinite(target) || target < 0) throw fail('Stock must be 0 or more');
            delta = round2(target - (item.track_stock ? Number(item.stock_qty || 0) : 0));
            if (!item.track_stock) reason = reason || 'opening';
        } else {
            delta = num(change);
            if (!Number.isFinite(delta) || delta === 0) throw fail('Enter how many to add or remove');
        }
        if (Math.abs(delta) > 1000000) throw fail('That is too large a change');

        const why = REASONS.includes(reason) ? reason : (delta >= 0 ? 'restock' : 'adjust');
        const balance = delta === 0 && item.track_stock
            ? Number(item.stock_qty || 0)
            : await applyChange(userId, itemId, delta, why, { note });
        return { id: itemId, stock_qty: balance, track_stock: true, low_stock_alert: item.low_stock_alert, change: delta, reason: why };
    }

    /** The item's stock and its latest movements (newest first) */
    static async history(userId, itemId, limit = 30) {
        const item = await UserMenuItem.findByIdAndUser(itemId, userId);
        if (!item) return null;
        const rows = await query(
            'SELECT id, change, balance_after, reason, bill_id, note, created_at FROM stock_movements WHERE user_id = ? AND user_menu_item_id = ? ORDER BY created_at DESC LIMIT ?',
            [userId, itemId, Math.max(1, Math.min(200, limit))]
        ).catch(() => []);
        return {
            item: { id: item.id, name: item.name, stock_qty: item.stock_qty, low_stock_alert: item.low_stock_alert, track_stock: item.track_stock, price: item.price },
            movements: (rows || []).map((r) => ({ ...r, change: Number(r.change), balance_after: num(r.balance_after) }))
        };
    }

    /** Totals for the inventory strip on the Menu page */
    static async summary(userId) {
        const items = await UserMenuItem.findByUserId(userId, '', 'all', '');
        const tracked = items.filter((it) => it.track_stock);
        const out = tracked.filter((it) => Number(it.stock_qty || 0) <= 0);
        const low = tracked.filter((it) => Number(it.stock_qty || 0) > 0 && Number(it.stock_qty || 0) <= Number(it.low_stock_alert || 0));
        const value = tracked.reduce((sum, it) => sum + Math.max(0, Number(it.stock_qty || 0)) * Number(it.price || 0), 0);
        const units = tracked.reduce((sum, it) => sum + Math.max(0, Number(it.stock_qty || 0)), 0);
        return {
            total_items: items.length,
            tracked_items: tracked.length,
            untracked_items: items.length - tracked.length,
            low_stock: low.length,
            out_of_stock: out.length,
            total_units: round2(units),
            stock_value: round2(value)
        };
    }

    /** Takes a bill's items out of stock. Re-running it for the same bill (after an edit) first puts the old items back. */
    static async syncBill(userId, billId, items, billNumber) {
        if (!billId) return;
        const shop = await Shop.findByUserId(userId);
        if (!isInventoryType(shop?.business_type)) return;

        await Inventory.reverseBill(userId, billId);

        // quantities per menu item (the same item may appear on more than one line)
        const totals = await trackedTotals(userId, items);
        for (const [itemId, { qty }] of totals) {
            if (qty > 0) {
                await applyChange(userId, itemId, -round2(qty), 'sale', { billId, note: billNumber ? `Bill #${billNumber}` : 'Bill' });
            }
        }
    }

    /** Puts back everything a bill took out of stock (bill edited or deleted) */
    static async reverseBill(userId, billId) {
        if (!billId) return;
        const rows = await query(
            "SELECT id, user_menu_item_id, change FROM stock_movements WHERE user_id = ? AND bill_id = ? AND reason = 'sale'",
            [userId, billId]
        ).catch(() => []);
        for (const r of rows || []) {
            await query(
                'UPDATE user_menu_items SET stock_qty = COALESCE(stock_qty, 0) - ?, updated_at = ? WHERE id = ? AND user_id = ?',
                [Number(r.change), new Date().toISOString(), r.user_menu_item_id, userId]
            );
            await query('DELETE FROM stock_movements WHERE id = ? AND user_id = ?', [r.id, userId]);
        }
    }
}
