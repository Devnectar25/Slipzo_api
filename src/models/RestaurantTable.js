import { v4 as uuidv4 } from 'uuid';
import { query, queryOne, insert, update } from '../config/database.js';

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

    static async updateTable(userId, tableIdentifier, updates) {
        if (!userId || !tableIdentifier) return null;

        // Try lookup by id first
        let existing = await queryOne('SELECT * FROM restaurant_tables WHERE user_id = ? AND id = ?', [userId, String(tableIdentifier)]);

        // If not found, resolve table_number from identifier (e.g. 1, "1", "table-1", "table_1", "Table 1")
        if (!existing) {
            let num = null;
            if (!isNaN(Number(tableIdentifier))) {
                num = Number(tableIdentifier);
            } else if (typeof tableIdentifier === 'string') {
                const match = tableIdentifier.trim().match(/^table[-_\s]?(\d+)$/i);
                if (match) {
                    num = Number(match[1]);
                }
            }
            if (num !== null) {
                existing = await queryOne('SELECT * FROM restaurant_tables WHERE user_id = ? AND table_number = ?', [userId, num]);
            }
        }

        // If table record doesn't exist yet for this user, auto-create it
        if (!existing) {
            let tableNum = 1;
            if (!isNaN(Number(tableIdentifier))) {
                tableNum = Number(tableIdentifier);
            } else if (typeof tableIdentifier === 'string') {
                const match = tableIdentifier.trim().match(/^table[-_\s]?(\d+)$/i);
                if (match) tableNum = Number(match[1]);
            }
            const tableId = (String(tableIdentifier).length === 36 && String(tableIdentifier).includes('-')) ? tableIdentifier : uuidv4();
            const newTable = {
                id: tableId,
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
