import { query, queryOne } from '../config/database.js';

/**
 * Which waiting bill belongs to the order that is on a restaurant table right now. With it, the order stays one bill
 * whoever saves or prints it (waiter on one phone, cashier on another). Forgotten as soon as the table is cleared, so
 * the next customers always start a new bill.
 */
let ready = null;
const ensureTable = () => {
    if (!ready) {
        ready = query(`CREATE TABLE IF NOT EXISTS table_open_bills (
            user_id TEXT NOT NULL,
            table_id TEXT NOT NULL,
            bill_id TEXT NOT NULL,
            updated_at BIGINT DEFAULT 0,
            PRIMARY KEY (user_id, table_id)
        )`).catch((err) => { ready = null; throw err; });
    }
    return ready;
};

export default class TableBill {
    /** The order's bill, when it is still waiting to print; else null */
    static async find(userId, tableId) {
        await ensureTable();
        const row = await queryOne(
            'SELECT b.id FROM table_open_bills o JOIN saved_bills b ON b.id = o.bill_id AND b.user_id = o.user_id WHERE o.user_id = ? AND o.table_id = ?',
            [userId, tableId]
        );
        return row?.id || null;
    }

    /** The bill of the order on the table, printed or not; null when the table has none */
    static async linked(userId, tableId) {
        await ensureTable();
        const row = await queryOne('SELECT bill_id FROM table_open_bills WHERE user_id = ? AND table_id = ?', [userId, tableId]);
        return row?.bill_id || null;
    }

    static async set(userId, tableId, billId) {
        await ensureTable();
        await query(
            `INSERT INTO table_open_bills (user_id, table_id, bill_id, updated_at) VALUES (?, ?, ?, ?)
             ON CONFLICT (user_id, table_id) DO UPDATE SET bill_id = excluded.bill_id, updated_at = excluded.updated_at`,
            [userId, tableId, billId, Date.now()]
        );
    }

    /** The table was cleared. tableId left out: all tables of the shop. */
    static async clear(userId, tableId = null) {
        try {
            await ensureTable();
            if (tableId) await query('DELETE FROM table_open_bills WHERE user_id = ? AND table_id = ?', [userId, tableId]);
            else await query('DELETE FROM table_open_bills WHERE user_id = ?', [userId]);
        } catch (err) {
            console.warn('⚠️ Could not clear the table\'s bill:', err.message);
        }
    }
}
