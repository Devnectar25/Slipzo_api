import UserMenuItem from '../models/UserMenuItem.js';
import MenuItem from '../models/MenuItem.js';
import Shop from '../models/Shop.js';

/**
 * GET /api/menu
 * Returns ONLY the logged-in user's personal menu items with custom prices
 */
export const getMenuItems = async (req, res, next) => {
    try {
        let { search, category, business_type } = req.query;
        if (!business_type) {
            const shop = await Shop.findByUserId(req.user.id);
            if (shop && shop.business_type) {
                business_type = shop.business_type;
            }
        }
        const items = await UserMenuItem.findByUserId(req.user.id, search || '', category || 'all', business_type || '');
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
        let { search, category, business_type } = req.query;
        if (!business_type) {
            const shop = await Shop.findByUserId(req.user.id);
            if (shop && shop.business_type) {
                business_type = shop.business_type;
            }
        }
        const catalog = await MenuItem.findCatalogForUser(req.user.id, search || '', category || 'all', business_type || '');
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

/**
 * GET /api/menu/barcode/:barcode
 * Scans or looks up a product by barcode for the current user:
 * 1. Checks user's personal menu first (with custom_price).
 * 2. If not found in user menu, checks the master catalog.
 */
export const lookupByBarcode = async (req, res, next) => {
    try {
        const { barcode } = req.params;
        if (!barcode || !barcode.trim()) {
            return res.status(400).json({ detail: 'Barcode is required' });
        }

        let cleanBarcode = barcode.trim();
        if (/^-4-+\d+$/i.test(cleanBarcode)) {
            const numPart = cleanBarcode.replace(/^-4-+/, "");
            cleanBarcode = `SLP-${numPart.padStart(6, "0")}`;
        } else if (/^SLP\d+$/i.test(cleanBarcode)) {
            const numPart = cleanBarcode.slice(3);
            cleanBarcode = `SLP-${numPart.padStart(6, "0")}`;
        } else if (/^SLP-\d+$/i.test(cleanBarcode)) {
            const numPart = cleanBarcode.slice(4);
            cleanBarcode = `SLP-${numPart.padStart(6, "0")}`;
        }

        // 1. Check user's personal menu first (using current authenticated shopkeeper context)
        const userItem = await UserMenuItem.findByBarcodeAndUser(req.user.id, cleanBarcode);
        if (userItem) {
            // Check BOTH shopkeeper's menu active status AND Admin master catalog availability
            const isUserActive = userItem.is_active !== false;
            const isMasterAvailable = userItem.is_available !== false;

            if (!isUserActive || !isMasterAvailable) {
                return res.status(422).json({
                    found: true,
                    available: false,
                    is_active: false,
                    code: 'ITEM_UNAVAILABLE',
                    detail: 'This item is currently unavailable in your menu and cannot be added to the bill.',
                    item: userItem
                });
            }

            return res.json({
                found: true,
                available: true,
                is_active: true,
                source: 'user_menu',
                item: userItem
            });
        }

        // 2. Check master catalog if not in user's personal menu
        const masterItem = await MenuItem.findByBarcode(cleanBarcode);
        if (masterItem) {
            return res.status(422).json({
                found: true,
                available: false,
                in_catalog: true,
                is_in_user_menu: false,
                code: 'NOT_IN_USER_MENU',
                detail: 'This item is currently unavailable in your menu and cannot be added to the bill.',
                catalog_item: {
                    id: masterItem.id,
                    name: masterItem.name,
                    price: masterItem.price,
                    category: masterItem.category,
                    image_url: masterItem.image_url,
                    description: masterItem.description,
                    barcode: masterItem.barcode,
                    barcode_type: masterItem.barcode_type,
                    is_available: masterItem.is_available
                }
            });
        }

        return res.status(404).json({
            found: false,
            available: false,
            code: 'PRODUCT_NOT_FOUND',
            detail: 'Product Not Found',
            barcode: cleanBarcode
        });
    } catch (err) {
        next(err);
    }
};

