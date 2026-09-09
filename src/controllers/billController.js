import Bill from '../models/Bill.js';
import Shop from '../models/Shop.js';
import Template from '../models/Template.js';

export const getBills = async (req, res, next) => {
    try {
        const { page, limit, search, payment_mode } = req.query;
        const options = {};
        if (page !== undefined && limit !== undefined) {
            options.page = page;
            options.limit = limit;
        }
        if (search) options.search = search;
        if (payment_mode) options.payment_mode = payment_mode;

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
        
        // Get shop
        const shop = await Shop.findByUserId(req.user.id);
        if (!shop) {
            return res.status(400).json({ 
                detail: 'Shop profile not found. Please set up your shop first.' 
            });
        }
        
        // Get template
        const template = await Template.findByIdAndUser(template_id, req.user.id);
        if (!template) {
            return res.status(400).json({ 
                detail: 'Invalid template' 
            });
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
        
        res.status(201).json(bill);
    } catch (err) {
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