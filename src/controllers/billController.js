import Bill from '../models/Bill.js';
import Shop from '../models/Shop.js';
import Template from '../models/Template.js';
import Subscription from '../models/Subscription.js';

export const getBills = async (req, res, next) => {
    try {
        const { page, limit, search, payment_mode, days_limit } = req.query;
        const options = {};
        if (page !== undefined && limit !== undefined) {
            options.page = page;
            options.limit = limit;
        }
        if (search) options.search = search;
        if (payment_mode) options.payment_mode = payment_mode;
        if (days_limit) options.daysLimit = days_limit;

        const result = await Bill.findByUserId(req.user.id, options);
        res.json(result);
    } catch (err) {
        next(err);
    }
};

export const createBill = async (req, res, next) => {
    try {
        const {
            template_id,
            items,
            discount,
            tax_rate,
            payment_mode,
            customer_id,
            customer_name,
            customer_phone,
            number
        } = req.body;
        
        // Validate items with proper checks
        if (!items || !items.length) {
            return res.status(400).json({ 
                detail: 'At least one item is required' 
            });
        }

        // Validate and normalize items
        const normalizedItems = items.map((item, index) => {
            const name = String(item.name || '').trim();
            const quantity = Number(item.quantity);
            const rate = Number(item.rate);

            if (!name) {
                throw new Error(`Item ${index + 1}: Name is required`);
            }

            if (!Number.isFinite(quantity) || quantity <= 0) {
                throw new Error(`Item ${index + 1}: Quantity must be at least 1`);
            }

            if (!Number.isFinite(rate) || rate < 0) {
                throw new Error(`Item ${index + 1}: Rate cannot be negative`);
            }

            return { name, quantity, rate };
        });
        
        // Get shop: auto-create default if not found
        let shop = await Shop.findByUserId(req.user.id);
        if (!shop) {
            shop = await Shop.create({
                user_id: req.user.id,
                name: `${req.user.name || 'My'} Shop`,
                phone: '',
                address: ''
            });
        }
        
        // Get template: try exact ID match, name/alias match, or default fallback
        let template = null;
        if (template_id) {
            template = await Template.findByIdAndUser(template_id, req.user.id);
            if (!template) {
                template = await Template.findById(template_id);
            }
        }
        
        if (!template) {
            const userTemplates = await Template.findByUserId(req.user.id);
            if (Array.isArray(userTemplates) && userTemplates.length > 0) {
                const targetStr = String(template_id || shop.default_template_id || '').trim().toLowerCase();
                
                const aliasMap = {
                    'classic': ['classic receipt', 'classic'],
                    '1': ['classic receipt', 'classic'],
                    'minimal': ['minimal clean bill', 'minimal'],
                    '2': ['minimal clean bill', 'minimal'],
                    'pro': ['shop pro', 'pro'],
                    '3': ['shop pro', 'pro'],
                    'eco': ['eco print', 'eco'],
                    '4': ['eco print', 'eco'],
                    'modern': ['modern shop', 'modern'],
                    '5': ['modern shop', 'modern'],
                    'elite': ['business elite', 'elite'],
                    '6': ['business elite', 'elite']
                };
                const aliases = aliasMap[targetStr] || [];

                template = userTemplates.find((t) => {
                    const tId = String(t.id || '').toLowerCase();
                    const tName = String(t.name || '').toLowerCase();
                    if (tId === targetStr || tName === targetStr) return true;
                    if (aliases.some(a => tName.includes(a) || tId === a)) return true;
                    return false;
                }) || userTemplates.find(t => t.is_default) || userTemplates[0];
            }
        }

        if (!template) {
            // Ultimate fallback to default builtin template definition
            template = {
                id: template_id || 'default-1',
                name: 'Classic Receipt',
                width: '58mm'
            };
        }
        
        // Create bill with transaction
        const bill = await Bill.create({
            user_id: req.user.id,
            template_id: template.id,
            customer_id: customer_id || null,
            customer_name: customer_name?.trim() || '',
            customer_phone: customer_phone?.trim() || '',
            number: number?.trim() || '',
            items: normalizedItems,
            discount: Number(discount) || 0,
            tax_rate: Number(tax_rate) || 0,
            payment_mode: payment_mode || 'Cash',
            shop_name: shop.name,
            shop_address: shop.address,
            shop_phone: shop.phone,
            template_name: template.name,
            template_width: template.width || '58mm',
            shop
        });

        // Fetch updated quota after successful bill insertion
        const updatedQuota = await Subscription.getQuotaByUserId(req.user.id);
        
        // Return bill object augmented with updated quota
        const responseData = typeof bill.toJSON === 'function' ? bill.toJSON() : { ...bill };
        responseData.quota = updatedQuota;
        
        res.status(201).json(responseData);
    } catch (err) {
        if (err.statusCode) {
            return res.status(err.statusCode).json({ detail: err.message });
        }
        next(err);
    }
};

export const getBill = async (req, res) => {
    const { id } = req.params;
    const bill = await Bill.findByIdAndUser(id, req.user.id);
    
    if (!bill) {
        return res.status(404).json({ detail: 'Bill not found' });
    }
    
    res.json(bill);
};

export const getBillStats = async (req, res) => {
    const stats = await Bill.getTodaySales(req.user.id);
    res.json(stats);
};

export const deleteBill = async (req, res, next) => {
    try {
        const { id } = req.params;
        const deleted = await Bill.delete(id, req.user.id);
        
        if (!deleted) {
            return res.status(404).json({ detail: 'Bill not found or unauthorized' });
        }
        
        res.json({ message: 'Bill deleted successfully', id });
    } catch (err) {
        next(err);
    }
};