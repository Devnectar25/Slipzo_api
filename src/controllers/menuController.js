import MenuItem from '../models/MenuItem.js';

export const getMenuItems = async (req, res, next) => {
    try {
        const { search } = req.query;
        const items = await MenuItem.findByUserId(req.user.id, search || '');
        res.json(items);
    } catch (err) {
        next(err);
    }
};

export const createMenuItem = async (req, res, next) => {
    try {
        const { name, price } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ detail: 'Item name is required' });
        }

        if (name.trim().length > 100) {
            return res.status(400).json({ detail: 'Item name cannot exceed 100 characters' });
        }

        const numericPrice = parseFloat(price);
        if (price === undefined || price === null || isNaN(numericPrice) || numericPrice < 0) {
            return res.status(400).json({ detail: 'Item price must be a non-negative number' });
        }

        const item = await MenuItem.create({
            user_id: req.user.id,
            name: name.trim(),
            price: numericPrice
        });

        res.status(201).json(item);
    } catch (err) {
        next(err);
    }
};

export const updateMenuItem = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { name, price } = req.body;

        if (name !== undefined) {
            if (!name || !name.trim()) {
                return res.status(400).json({ detail: 'Item name cannot be empty' });
            }
            if (name.trim().length > 100) {
                return res.status(400).json({ detail: 'Item name cannot exceed 100 characters' });
            }
        }

        if (price !== undefined) {
            const numericPrice = parseFloat(price);
            if (isNaN(numericPrice) || numericPrice < 0) {
                return res.status(400).json({ detail: 'Item price must be a non-negative number' });
            }
        }

        const item = await MenuItem.update(id, req.user.id, req.body);

        if (!item) {
            return res.status(404).json({ detail: 'Menu item not found' });
        }

        res.json(item);
    } catch (err) {
        next(err);
    }
};

export const deleteMenuItem = async (req, res, next) => {
    try {
        const { id } = req.params;
        const success = await MenuItem.delete(id, req.user.id);

        if (!success) {
            return res.status(404).json({ detail: 'Menu item not found' });
        }

        res.json({ detail: 'Menu item deleted successfully' });
    } catch (err) {
        next(err);
    }
};
