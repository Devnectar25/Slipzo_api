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
