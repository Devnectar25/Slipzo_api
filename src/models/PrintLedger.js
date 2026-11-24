import { query, beginTransaction } from '../config/database.js';

/**
 * One line for every print: which shop, who printed (owner or worker), which bill. The shop's print count goes up in the
 * same transaction as the line is written, so the two can never disagree, and a print that is reported twice (the answer
 * got lost and the phone sends it again) is counted once: every print has its own print_id.
 */
let ready = null;
const ensureTable = () => {
    if (!ready) {
        ready = (async () => {
            await query(`CREATE TABLE IF NOT EXISTS print_events (
                user_id TEXT NOT NULL,
                print_id TEXT NOT NULL,
                worker_id TEXT,
                bill_id TEXT,
                device TEXT,
                created_at BIGINT DEFAULT 0,
                PRIMARY KEY (user_id, print_id)
            )`);
            await query('CREATE INDEX IF NOT EXISTS idx_print_events_day ON print_events (user_id, created_at)');
        })().catch((err) => { ready = null; throw err; });
    }
    return ready;
};

const clean = (v, max) => String(v ?? '').trim().slice(0, max);
export const cleanPrintId = (v) => clean(v, 80);

const countUp = (run, userId, limit) => (limit === null
    ? run('UPDATE users SET prints_used = COALESCE(prints_used, 0) + 1 WHERE id = ?', [userId])
    // checked and used in one statement: two devices can never use the same last credit
    : run('UPDATE users SET prints_used = COALESCE(prints_used, 0) + 1 WHERE id = ? AND COALESCE(prints_used, 0) < ?', [userId, limit]));

export default class PrintLedger {
    /**
     * Counts one print. limit: the most prints the shop may use, null for no limit.
     * Resolves 'counted', 'already' (this print_id was counted before) or 'refused' (no credits left).
     */
    static async countOnce(userId, { printId, workerId, billId, device, limit }) {
        try {
            await ensureTable();
        } catch (err) {
            // the list is extra: printing must go on even when its table cannot be made
            console.warn('⚠️ Print list not available:', err.message);
            const used = await countUp(query, userId, limit);
            return Number(used?.affectedRows || 0) ? 'counted' : 'refused';
        }
        const tx = await beginTransaction();
        try {
            const added = await tx.query(
                'INSERT INTO print_events (user_id, print_id, worker_id, bill_id, device, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (user_id, print_id) DO NOTHING',
                [userId, printId, workerId || userId, clean(billId, 80) || null, clean(device, 60) || null, Date.now()]
            );
            if (!Number(added?.affectedRows || 0)) {
                await tx.rollback();
                return 'already';
            }
            const used = await countUp((sql, params) => tx.query(sql, params), userId, limit);
            if (!Number(used?.affectedRows || 0)) {
                await tx.rollback();
                return 'refused';
            }
            await tx.commit();
            return 'counted';
        } catch (err) {
            await tx.rollback();
            throw err;
        } finally {
            tx.release();
        }
    }

    /** Prints per person: today (since fromMs) and in the last 30 days */
    static async byPerson(userId, fromMs) {
        await ensureTable();
        const rows = await query(
            `SELECT e.worker_id, MAX(u.name) AS name, COUNT(*) AS month_count, SUM(CASE WHEN e.created_at >= ? THEN 1 ELSE 0 END) AS today_count
             FROM print_events e LEFT JOIN users u ON u.id = e.worker_id
             WHERE e.user_id = ? AND e.created_at >= ?
             GROUP BY e.worker_id`,
            [fromMs, userId, Date.now() - 30 * 24 * 60 * 60 * 1000]
        );
        return (rows || []).map((r) => ({
            worker_id: r.worker_id,
            name: r.name || '',
            is_owner: r.worker_id === userId,
            today: Number(r.today_count || 0),
            month: Number(r.month_count || 0)
        })).sort((a, b) => b.today - a.today || b.month - a.month);
    }
}
