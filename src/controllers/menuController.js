import UserMenuItem from '../models/UserMenuItem.js';
import MenuItem from '../models/MenuItem.js';

/**
 * GET /api/menu
 * Returns ONLY the logged-in user's personal menu items with custom prices
 */
export const getMenuItems = async (req, res, next) => {
    try {
        const { search, category } = req.query;
        const items = await UserMenuItem.findByUserId(req.user.id, search || '', category || 'all');
        res.json(items);
    } catch (err) {
        next(err);
    }
};

/**
 * GET /api/menu/catalog
 * Returns the Master Catalog available for the user to add to their menu
 * Includes `is_added: true/false` and current `user_price` if already added
 */
export const getCatalogItems = async (req, res, next) => {
    try {
        const { search, category } = req.query;
        const catalog = await MenuItem.findCatalogForUser(req.user.id, search || '', category || 'all');
        res.json(catalog);
    } catch (err) {
        next(err);
    }
};

/**
 * POST /api/menu
 * Add an item to the user's personal menu
 * Supports either:
 *  - { menu_item_id, price / custom_price } (adding an existing catalog item)
 *  - { name, price, category, image_url, description } (custom new item)
 */
export const createMenuItem = async (req, res, next) => {
    try {
        const { menu_item_id, price, custom_price, name, category, image_url, description } = req.body;

        let targetMenuItemId = menu_item_id;
        const numericPrice = parseFloat(custom_price !== undefined ? custom_price : price);

        if (price === undefined && custom_price === undefined) {
            return res.status(400).json({ detail: 'Selling price is required' });
        }

        if (isNaN(numericPrice) || numericPrice < 0) {
            return res.status(400).json({ detail: 'Selling price must be a non-negative number' });
        }

        // If no menu_item_id provided, create a custom master item first
        if (!targetMenuItemId) {
            if (!name || !name.trim()) {
                return res.status(400).json({ detail: 'Item name is required' });
            }
            const masterItem = await MenuItem.createMaster({
                name: name.trim(),
                price: numericPrice,
                category: (category || '').trim() || 'General',
                image_url: image_url || '',
                description: (description || '').trim()
            });
            targetMenuItemId = masterItem.id;
        }

        // Add to user_menu_items
        const userItem = await UserMenuItem.create(req.user.id, targetMenuItemId, numericPrice);
        res.status(201).json(userItem);
    } catch (err) {
        next(err);
    }
};

/**
 * PUT /api/menu/:id
 * Updates selling price or active status for a user's personal menu item
 * Does NOT mutate the master catalog!
 */
export const updateMenuItem = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { price, custom_price, is_active } = req.body;

        if (price !== undefined || custom_price !== undefined) {
            const rawPrice = custom_price !== undefined ? custom_price : price;
            const numericPrice = parseFloat(rawPrice);
            if (isNaN(numericPrice) || numericPrice < 0) {
                return res.status(400).json({ detail: 'Selling price must be a non-negative number' });
            }
        }

        const updated = await UserMenuItem.update(id, req.user.id, {
            custom_price: custom_price !== undefined ? custom_price : price,
            is_active
        });

        if (!updated) {
            return res.status(404).json({ detail: 'Menu item not found in your personal menu' });
        }

        res.json(updated);
    } catch (err) {
        next(err);
    }
};

/**
 * DELETE /api/menu/:id
 * Removes an item from the user's personal menu
 * Does NOT delete the master catalog record!
 */
export const deleteMenuItem = async (req, res, next) => {
    try {
        const { id } = req.params;
        const success = await UserMenuItem.delete(id, req.user.id);

        if (!success) {
            return res.status(404).json({ detail: 'Menu item not found in your personal menu' });
        }

        res.json({ detail: 'Item removed from your menu successfully' });
    } catch (err) {
        next(err);
    }
};
