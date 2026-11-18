import RestaurantTable from '../models/RestaurantTable.js';
import Shop from '../models/Shop.js';

export const getTables = async (req, res, next) => {
    try {
        const shop = await Shop.findByUserId(req.user.id);
        const configuredCount = shop?.table_count || 10;
        const tables = await RestaurantTable.getTablesByUserId(req.user.id, configuredCount);
        res.json(tables);
    } catch (err) {
        next(err);
    }
};

export const updateTable = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { status, current_items, total_amount } = req.body;

        const updated = await RestaurantTable.updateTable(req.user.id, id, {
            status,
            current_items,
            total_amount
        });

        if (!updated) {
            return res.status(404).json({ detail: 'Table not found' });
        }

        res.json(updated);
    } catch (err) {
        next(err);
    }
};

export const resetTable = async (req, res, next) => {
    try {
        const { id } = req.params;
        const reset = await RestaurantTable.resetTable(req.user.id, id);

        if (!reset) {
            return res.status(404).json({ detail: 'Table not found' });
        }

        res.json({
            message: 'Table reset successfully',
            table: reset
        });
    } catch (err) {
        next(err);
    }
};

export const resetAllTables = async (req, res, next) => {
    try {
        const tables = await RestaurantTable.resetAllTables(req.user.id);
        res.json({
            message: 'All tables reset successfully',
            tables
        });
    } catch (err) {
        next(err);
    }
};

/**
 * POST /restaurant/tables/release-old  { from: <ISO of the shop's local midnight> }
 * Frees every table still holding an order from before today. Only a midnight within the last day is accepted
 * (same rule as the analytics), so a wrong phone clock cannot clear tables that are in use.
 */
export const releaseOldTables = async (req, res, next) => {
    try {
        const from = new Date(String(req.body?.from || ''));
        const now = Date.now();
        if (Number.isNaN(from.getTime()) || from.getTime() > now || now - from.getTime() > 25 * 60 * 60 * 1000) {
            return res.status(400).json({ detail: 'from must be the start of today' });
        }
        const released = await RestaurantTable.releaseTablesOpenedBefore(req.user.id, from.toISOString());
        const shop = await Shop.findByUserId(req.user.id);
        const tables = await RestaurantTable.getTablesByUserId(req.user.id, shop?.table_count || 10);
        res.json({ released, tables });
    } catch (err) {
        next(err);
    }
};

export const setupTables = async (req, res, next) => {
    try {
        const { table_count } = req.body;
        const count = Number(table_count);

        if (isNaN(count) || count < 1 || count > 200) {
            return res.status(400).json({ detail: 'Table count must be between 1 and 200' });
        }

        const tables = await RestaurantTable.setupTables(req.user.id, count);
        res.json({
            message: 'Tables configured successfully',
            table_count: count,
            tables
        });
    } catch (err) {
        next(err);
    }
};
