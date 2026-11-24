import { v4 as uuidv4 } from 'uuid';
import { query, queryOne, insert, update, beginTransaction } from '../config/database.js';
import { mergeOrders, sameOrder } from '../utils/orderMerge.js';
import TableBill from './TableBill.js';

const plainDigits = (text) => text.replace(/[०-९]/g, (d) => String('०१२३४५६७८९'.indexOf(d)));

/** 5, "5", "table-5", "Table 5", "टेबल ५" → 5. Anything else → null: an unknown name must never mean table 1. */
export const tableNumberOf = (identifier) => {
    const text = plainDigits(String(identifier ?? '').trim());
    if (/^\d+$/.test(text)) return Number(text) || null;
    const match = text.match(/^(?:table|टेबल|मेज़?)[-_\s]*(\d+)$/i);
    return match ? Number(match[1]) || null : null;
};

export default class RestaurantTable {
    constructor(data) {
        this.id = data.id || uuidv4();
        this.user_id = data.user_id;
        this.table_number = Number(data.table_number || 1);
        this.name = data.name || `Table ${this.table_number}`;
        this.status = data.status || 'AVAILABLE';
        
        let parsedItems = data.current_items;
        if (typeof parsedItems === 'string') {
            try {
                parsedItems = JSON.parse(parsedItems);
            } catch (e) {
                parsedItems = [];
            }
        }
        this.current_items = Array.isArray(parsedItems) ? parsedItems : [];
        this.total_amount = Number(data.total_amount || 0);
        this.created_at = data.created_at;
        this.updated_at = data.updated_at;
    }

    static async getTablesByUserId(userId, defaultCount = 10) {
        // Fetch existing tables for user
        let rows = await query(
            'SELECT * FROM restaurant_tables WHERE user_id = ? ORDER BY table_number ASC',
            [userId]
        );

        const countToUse = Math.max(1, Math.min(Number(defaultCount) || 10, 200));

        // If no tables exist yet, initialize them
        if (!rows || rows.length === 0) {
            const initialTables = [];
            for (let i = 1; i <= countToUse; i++) {
                const tableId = uuidv4();
                const tableData = {
                    id: tableId,
                    user_id: userId,
                    table_number: i,
                    name: `Table ${i}`,
                    status: 'AVAILABLE',
                    current_items: '[]',
                    total_amount: 0.00
                };
                await insert('restaurant_tables', tableData);
                initialTables.push(new RestaurantTable(tableData));
            }
            return initialTables;
        }

        // If user already has tables, return them
        return rows.map(r => new RestaurantTable(r));
    }

    /** The shop's table by id, number ("5", "Table 5", "टेबल ५") or its own name. null when there is none. */
    static async find(userId, tableIdentifier) {
        if (!userId || !tableIdentifier) return null;
        const byId = await queryOne('SELECT * FROM restaurant_tables WHERE user_id = ? AND id = ?', [userId, String(tableIdentifier)]);
        if (byId) return byId;
        const byName = await queryOne('SELECT * FROM restaurant_tables WHERE user_id = ? AND name = ? ORDER BY table_number LIMIT 1', [userId, String(tableIdentifier).trim()]);
        if (byName) return byName;
        const num = tableNumberOf(tableIdentifier);
        return num ? await queryOne('SELECT * FROM restaurant_tables WHERE user_id = ? AND table_number = ?', [userId, num]) : null;
    }

    static async updateTable(userId, tableIdentifier, updates) {
        if (!userId || !tableIdentifier) return null;

        let existing = await this.find(userId, tableIdentifier);

        // a numbered table that does not exist yet for this user is created
        const tableNum = tableNumberOf(tableIdentifier);
        if (!existing && tableNum) {
            const newTable = {
                id: uuidv4(),
                user_id: userId,
                table_number: tableNum,
                name: `Table ${tableNum}`,
                status: 'AVAILABLE',
                current_items: '[]',
                total_amount: 0.00
            };
            try {
                await insert('restaurant_tables', newTable);
                existing = newTable;
            } catch (err) {
                // If unique constraint hit concurrently, re-fetch
                existing = await queryOne('SELECT * FROM restaurant_tables WHERE user_id = ? AND table_number = ?', [userId, tableNum]);
            }
        }

        if (!existing) {
            return null;
        }

        const dataToUpdate = {
            updated_at: new Date().toISOString()
        };

        // The device says which order it started from (base_items): when another device changed the table meanwhile,
        // both changes are kept instead of the last one winning
        if (Array.isArray(updates.base_items) && Array.isArray(updates.current_items)) {
            const tx = await beginTransaction();
            try {
                await tx.query('UPDATE restaurant_tables SET status = status WHERE id = ?', [existing.id]); // row lock
                const [row] = await tx.query('SELECT * FROM restaurant_tables WHERE id = ?', [existing.id]);
                const theirs = new RestaurantTable(row || existing).current_items;
                const changedElsewhere = !sameOrder(updates.base_items, theirs);
                const items = changedElsewhere ? mergeOrders(updates.base_items, updates.current_items, theirs) : updates.current_items;
                const total = items.reduce((sum, it) => sum + (Number(it.quantity ?? it.qty) || 0) * (Number(it.rate ?? it.price) || 0), 0);
                await tx.query(
                    'UPDATE restaurant_tables SET status = ?, current_items = ?, total_amount = ?, updated_at = ? WHERE id = ?',
                    [items.length ? 'OCCUPIED' : 'AVAILABLE', JSON.stringify(items), Math.round(total * 100) / 100, dataToUpdate.updated_at, existing.id]
                );
                await tx.commit();
            } catch (err) {
                await tx.rollback();
                throw err;
            } finally {
                tx.release();
            }
            const merged = await queryOne('SELECT * FROM restaurant_tables WHERE id = ?', [existing.id]);
            if (merged && new RestaurantTable(merged).current_items.length === 0) await TableBill.clear(userId, existing.id);
            return merged ? new RestaurantTable(merged) : null;
        }

        if (updates.status !== undefined) {
            dataToUpdate.status = String(updates.status).toUpperCase() === 'OCCUPIED' ? 'OCCUPIED' : 'AVAILABLE';
        }

        if (updates.current_items !== undefined) {
            const items = Array.isArray(updates.current_items) ? updates.current_items : [];
            dataToUpdate.current_items = JSON.stringify(items);
            if (items.length > 0 && updates.status === undefined) {
                dataToUpdate.status = 'OCCUPIED';
            } else if (items.length === 0 && updates.status === undefined) {
                dataToUpdate.status = 'AVAILABLE';
            }
        }

        if (updates.total_amount !== undefined) {
            dataToUpdate.total_amount = Number(updates.total_amount) || 0.00;
        }

        await update('restaurant_tables', dataToUpdate, 'id = ?', [existing.id]);
        // cleared: the order's bill belongs to the customers who left
        if (dataToUpdate.status === 'AVAILABLE' || dataToUpdate.current_items === '[]') await TableBill.clear(userId, existing.id);
        const updated = await queryOne('SELECT * FROM restaurant_tables WHERE id = ?', [existing.id]);
        return updated ? new RestaurantTable(updated) : null;
    }

    static async resetTable(userId, tableIdentifier) {
        return await this.updateTable(userId, tableIdentifier, {
            status: 'AVAILABLE',
            current_items: [],
            total_amount: 0.00
        });
    }

    static async resetAllTables(userId) {
        if (!userId) return [];
        await query(
            "UPDATE restaurant_tables SET status = 'AVAILABLE', current_items = '[]', total_amount = 0.00, updated_at = ? WHERE user_id = ?",
            [new Date().toISOString(), userId]
        );
        await TableBill.clear(userId);
        return await this.getTablesByUserId(userId);
    }

    /**
     * A new day: every table whose order was last changed before `cutoffIso` (the shop's local midnight) is made
     * available again, so yesterday's unfinished orders do not keep tables occupied. The bills themselves are kept.
     * Dates are compared here rather than in SQL because updated_at is stored differently by SQLite and Postgres.
     * Returns how many tables were released.
     */
    static async releaseTablesOpenedBefore(userId, cutoffIso) {
        if (!userId || !cutoffIso) return 0;
        const cutoff = new Date(cutoffIso).getTime();
        if (Number.isNaN(cutoff)) return 0;
        const rows = await query('SELECT * FROM restaurant_tables WHERE user_id = ?', [userId]);
        const stale = (rows || []).filter((r) => {
            const t = new RestaurantTable(r);
            const occupied = String(t.status).toUpperCase() === 'OCCUPIED' || t.current_items.length > 0 || t.total_amount > 0;
            if (!occupied) return false;
            const changed = r.updated_at ? new Date(r.updated_at).getTime() : NaN;
            return Number.isNaN(changed) || changed < cutoff;
        });
        const now = new Date().toISOString();
        for (const r of stale) {
            await update('restaurant_tables', { status: 'AVAILABLE', current_items: '[]', total_amount: 0.00, updated_at: now }, 'id = ?', [r.id]);
            await TableBill.clear(userId, r.id);
        }
        return stale.length;
    }

    static async setupTables(userId, targetCount) {
        const count = Math.max(1, Math.min(Number(targetCount) || 10, 200));

        // Update shop table_count
        await update('shops', { table_count: count }, 'user_id = ?', [userId]);

        const existing = await query(
            'SELECT * FROM restaurant_tables WHERE user_id = ? ORDER BY table_number ASC',
            [userId]
        );

        const currentMax = existing.reduce((max, t) => Math.max(max, Number(t.table_number) || 0), 0);

        // If target count > current max, add missing tables
        if (count > currentMax) {
            for (let i = currentMax + 1; i <= count; i++) {
                await insert('restaurant_tables', {
                    id: uuidv4(),
                    user_id: userId,
                    table_number: i,
                    name: `Table ${i}`,
                    status: 'AVAILABLE',
                    current_items: '[]',
                    total_amount: 0.00
                });
            }
        } else if (count < existing.length) {
            // Only trim empty/available tables from the end beyond count
            const excess = existing.filter(t => t.table_number > count && t.status === 'AVAILABLE' && (!t.current_items || t.current_items === '[]'));
            for (const t of excess) {
                await query('DELETE FROM restaurant_tables WHERE id = ?', [t.id]);
            }
        }

        return await this.getTablesByUserId(userId, count);
    }
}
