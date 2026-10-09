import UserMenuItem from '../models/UserMenuItem.js';
import SmallBusiness from '../models/SmallBusiness.js';
import MenuItem from '../models/MenuItem.js';
import Shop from '../models/Shop.js';
import Catalog from '../models/Catalog.js';
import { supabase, insert, query, queryOne } from '../config/database.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Maps category selection string to the appropriate database table and Supabase storage bucket
 */
function getCategoryTableAndBucket(categoryInput) {
  const cat = String(categoryInput || '').toLowerCase().trim();

  if (cat.includes('hotel') || cat.includes('restaurant') || cat.includes('food')) {
    return {
      tableName: 'hotel_food',
      bucketName: 'hotel_food'
    };
  }

  if (cat.includes('cloth') || cat.includes('garment') || cat.includes('apparel')) {
    return {
      tableName: 'clothing_garments',
      bucketName: 'clothing_garments'
    };
  }

  if (cat.includes('kirana') || cat.includes('grocery')) {
    return {
      tableName: 'kirana_store',
      bucketName: 'kirana_store'
    };
  }

  if (cat.includes('small') || cat.includes('cafe') || cat.includes('tea') || cat.includes('business')) {
    return {
      tableName: 'small_business',
      bucketName: 'small_business'
    };
  }

  return {
    tableName: 'small_business',
    bucketName: 'menu-item-images'
  };
}

/**
 * Uploads a custom product image to Supabase Storage in the specified category bucket
 */
async function uploadCustomProductImage(rawData, itemName, userId, targetBucket = 'menu-item-images') {
  try {
    if (!rawData || !String(rawData).trim()) return '';
    const cleanStr = String(rawData).trim();
    if (cleanStr.startsWith('http://') || cleanStr.startsWith('https://')) {
      return cleanStr;
    }

    let mimeType = 'image/png';
    let ext = 'png';
    let base64Data = cleanStr;

    if (cleanStr.startsWith('data:')) {
      const match = cleanStr.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.*)$/);
      if (match) {
        mimeType = match[1];
        base64Data = match[2];
        if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') ext = 'jpg';
        else if (mimeType === 'image/webp') ext = 'webp';
        else if (mimeType === 'image/gif') ext = 'gif';
        else if (mimeType === 'image/svg+xml') ext = 'svg';
      }
    }

    const buffer = Buffer.from(base64Data, 'base64');
    const safeName = (itemName || 'item')
      .trim()
      .replace(/[^a-zA-Z0-9_\-]/g, '_')
      .replace(/_+/g, '_')
      .toLowerCase();

    const fileName = `custom/${userId}_${safeName}_${Date.now()}.${ext}`;

    // Upload to designated category bucket
    const { error: uploadError } = await supabase.storage
      .from(targetBucket)
      .upload(fileName, buffer, {
        contentType: mimeType,
        upsert: true
      });

    if (uploadError) {
      console.warn(`⚠️ Supabase custom image upload warning for bucket '${targetBucket}':`, uploadError.message);
      // Fallback attempt to default 'menu-item-images' bucket if primary category bucket doesn't exist
      if (targetBucket !== 'menu-item-images') {
        const { error: fallbackErr } = await supabase.storage
          .from('menu-item-images')
          .upload(fileName, buffer, { contentType: mimeType, upsert: true });
        if (!fallbackErr) {
          const { data: fallbackUrlData } = supabase.storage.from('menu-item-images').getPublicUrl(fileName);
          return fallbackUrlData?.publicUrl || cleanStr;
        }
      }
      return cleanStr;
    }

    const { data: urlData } = supabase.storage
      .from(targetBucket)
      .getPublicUrl(fileName);

    return urlData?.publicUrl || cleanStr;
  } catch (err) {
    console.error('Error in uploadCustomProductImage:', err);
    return rawData;
  }
}

/**
 * GET /api/menu
 * Returns ONLY the logged-in user's personal menu items with custom prices and barcode_active status
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
 * Returns the Master Catalog matching the user's shop category (business_type)
 * E.g. 'kirana_grocery' -> 100 Kirana products
 *      'small_business' -> 100 Small Business / Cafe / Tea products
 *      'clothing_garments' -> Cloth & Garments products
 *      'hotel_food' -> Hotel & Restaurant food products
 */
export const getCatalogItems = async (req, res, next) => {
    try {
        const { search, category, business_type } = req.query;

        let targetBusinessType = business_type;
        if (!targetBusinessType) {
            const userShop = await Shop.findByUserId(req.user.id);
            targetBusinessType = userShop?.business_type || 'small_business';
        }

        const catalog = await Catalog.findCatalogForUser(
            req.user.id, 
            targetBusinessType, 
            search || '', 
            category || 'all'
        );
        res.json(catalog);
    } catch (err) {
        next(err);
    }
};

/**
 * POST /api/menu
 * Add an item to the user's personal menu
 * Supports:
 *  - { menu_item_id, price / custom_price, barcode_active } (adding from catalog)
 *  - { name, price, category, image_url, description, barcode, barcode_active } (custom new item)
 */
export const createMenuItem = async (req, res, next) => {
    try {
        const { 
            menu_item_id, 
            price, 
            custom_price, 
            name, 
            category, 
            image_url, 
            description,
            barcode,
            barcode_active 
        } = req.body;

        let targetMenuItemId = menu_item_id;
        const numericPrice = parseFloat(custom_price !== undefined ? custom_price : price);

        let defaultBarcodeActive = true;
        if (barcode_active === undefined) {
            const userShop = await Shop.findByUserId(req.user.id);
            const bType = (userShop?.business_type || '').toLowerCase();
            if (bType.includes('small_business') || bType.includes('hotel') || bType.includes('food') || bType.includes('cafe')) {
                defaultBarcodeActive = false;
            }
        }
        const isBActive = barcode_active !== undefined ? Boolean(barcode_active) : defaultBarcodeActive;

        if (price === undefined && custom_price === undefined) {
            return res.status(400).json({ detail: 'Selling price is required' });
        }

        if (isNaN(numericPrice) || numericPrice < 0) {
            return res.status(400).json({ detail: 'Selling price must be a non-negative number' });
        }

        // Determine item name to check for duplicate product names
        let checkName = (name && String(name).trim()) ? String(name).trim() : '';
        if (!checkName && targetMenuItemId) {
            const catItem = await Catalog.findByBarcode(targetMenuItemId) || 
                            await queryOne(
                                `SELECT name FROM small_business WHERE id = ? 
                                 UNION SELECT name FROM kirana_store WHERE id = ? 
                                 UNION SELECT name FROM clothing_garments WHERE id = ? 
                                 UNION SELECT name FROM hotel_food WHERE id = ? 
                                 UNION SELECT name FROM menu_items WHERE id = ? LIMIT 1`, 
                                [targetMenuItemId, targetMenuItemId, targetMenuItemId, targetMenuItemId, targetMenuItemId]
                            );
            if (catItem && catItem.name) {
                checkName = catItem.name.trim();
            }
        }

        // Check if user already has an item with the same name in their personal menu
        if (checkName) {
            const userExisting = await queryOne(`
                SELECT umi.id, COALESCE(sb.name, ks.name, cg.name, hf.name, mi.name, '') as name
                FROM user_menu_items umi
                LEFT JOIN small_business sb ON umi.menu_item_id = sb.id
                LEFT JOIN kirana_store ks ON umi.menu_item_id = ks.id
                LEFT JOIN clothing_garments cg ON umi.menu_item_id = cg.id
                LEFT JOIN hotel_food hf ON umi.menu_item_id = hf.id
                LEFT JOIN menu_items mi ON umi.menu_item_id = mi.id
                WHERE umi.user_id = ? AND LOWER(TRIM(COALESCE(sb.name, ks.name, cg.name, hf.name, mi.name, ''))) = LOWER(TRIM(?))
                LIMIT 1
            `, [req.user.id, checkName]);

            if (userExisting) {
                return res.status(400).json({ detail: `Product "${checkName}" is already in your menu` });
            }
        }

        // If no menu_item_id provided, create a custom master item first in the corresponding category table & bucket
        if (!targetMenuItemId) {
            if (!name || !name.trim()) {
                return res.status(400).json({ detail: 'Item name is required' });
            }

            const { tableName, bucketName } = getCategoryTableAndBucket(category);

            // Prevent adding custom item with duplicate name in the catalog table
            const catalogNameCheck = await queryOne(
                `SELECT id, name FROM ${tableName} WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 1`,
                [name.trim()]
            );
            if (catalogNameCheck) {
                return res.status(400).json({ detail: `Product "${name.trim()}" already exists in the catalog. You can add it directly.` });
            }

            let finalImageUrl = image_url ? String(image_url).trim() : '';
            if (finalImageUrl && (finalImageUrl.startsWith('data:') || (finalImageUrl.length > 500 && !finalImageUrl.startsWith('http')))) {
                finalImageUrl = await uploadCustomProductImage(finalImageUrl, name, req.user.id, bucketName);
            }

            const customBarcode = (barcode && String(barcode).trim()) ? String(barcode).trim() : `CUST-${Date.now().toString().slice(-6)}`;
            const newItemId = uuidv4();
            const now = new Date().toISOString();

            const masterItemData = {
                id: newItemId,
                user_id: req.user.id,
                name: name.trim(),
                price: numericPrice,
                category: (category || '').trim() || 'General',
                image_url: finalImageUrl || '',
                description: (description || '').trim(),
                is_available: true,
                barcode: customBarcode,
                barcode_type: 'INTERNAL',
                created_at: now,
                updated_at: now
            };

            // Save record into the target category database table
            try {
                await insert(tableName, masterItemData);
            } catch (tblErr) {
                console.warn(`⚠️ Insert into table '${tableName}' warning:`, tblErr.message);
                await insert('small_business', masterItemData).catch(() => null);
            }

            targetMenuItemId = newItemId;
        }

        // Add to user_menu_items
        const userItem = await UserMenuItem.create(req.user.id, targetMenuItemId, numericPrice, isBActive);
        res.status(201).json(userItem);
    } catch (err) {
        next(err);
    }
};

/**
 * PUT /api/menu/:id
 * Updates selling price, active status, or barcode_active for a user's personal menu item
 */
export const updateMenuItem = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { price, custom_price, is_active, barcode_active } = req.body;

        if (price !== undefined || custom_price !== undefined) {
            const rawPrice = custom_price !== undefined ? custom_price : price;
            const numericPrice = parseFloat(rawPrice);
            if (isNaN(numericPrice) || numericPrice < 0) {
                return res.status(400).json({ detail: 'Selling price must be a non-negative number' });
            }
        }

        const updates = {};
        if (custom_price !== undefined || price !== undefined) {
            updates.custom_price = custom_price !== undefined ? custom_price : price;
        }
        if (is_active !== undefined) {
            updates.is_active = Boolean(is_active);
        }
        if (barcode_active !== undefined) {
            updates.barcode_active = Boolean(barcode_active);
        }

        const updated = await UserMenuItem.update(id, req.user.id, updates);

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
 * 2. If not found in user menu, checks small_business master catalog.
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
            cleanBarcode = `SB-${numPart.padStart(6, "0")}`;
        } else if (/^SB\d+$/i.test(cleanBarcode)) {
            const numPart = cleanBarcode.slice(2);
            cleanBarcode = `SB-${numPart.padStart(6, "0")}`;
        } else if (/^SLP\d+$/i.test(cleanBarcode)) {
            const numPart = cleanBarcode.slice(3);
            cleanBarcode = `SLP-${numPart.padStart(6, "0")}`;
        }

        // 1. Check user's personal menu first (using current authenticated shopkeeper context)
        const userItem = await UserMenuItem.findByBarcodeAndUser(req.user.id, cleanBarcode);
        if (userItem) {
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

        // 2. Check master catalog across all business categories
        const masterItem = await Catalog.findByBarcode(cleanBarcode);
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

/**
 * DELETE /api/menu
 * Clears all personal menu items for the authenticated user
 */
export const clearUserMenu = async (req, res, next) => {
    try {
        await UserMenuItem.deleteAllByUserId(req.user.id);
        res.json({ success: true, detail: 'Personal menu items cleared successfully' });
    } catch (err) {
        next(err);
    }
};



