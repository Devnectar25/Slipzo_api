import Product from '../models/Product.js';

export const getProducts = async (req, res, next) => {
    try {
        const { search, category } = req.query;
        const products = await Product.findByUserId(req.user.id, search, category);
        res.json(products);
    } catch (err) {
        next(err);
    }
};

export const getProductStats = async (req, res, next) => {
    try {
        const stats = await Product.getStats(req.user.id);
        res.json(stats);
    } catch (err) {
        next(err);
    }
};

export const getProduct = async (req, res, next) => {
    try {
        const { id } = req.params;
        const product = await Product.findByIdAndUser(id, req.user.id);

        if (!product) {
            return res.status(404).json({ detail: 'Product not found' });
        }

        res.json(product);
    } catch (err) {
        next(err);
    }
};

export const createProduct = async (req, res, next) => {
    try {
        const { name, price, category, sku, tax_rate, stock, description } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ detail: 'Product name is required' });
        }

        const product = await Product.create({
            user_id: req.user.id,
            name,
            price,
            category,
            sku,
            tax_rate,
            stock,
            description
        });

        res.status(201).json(product);
    } catch (err) {
        next(err);
    }
};

export const updateProduct = async (req, res, next) => {
    try {
        const { id } = req.params;
        const updated = await Product.update(id, req.user.id, req.body);

        if (!updated) {
            return res.status(404).json({ detail: 'Product not found' });
        }

        res.json(updated);
    } catch (err) {
        next(err);
    }
};

export const deleteProduct = async (req, res, next) => {
    try {
        const { id } = req.params;
        const deleted = await Product.delete(id, req.user.id);

        if (!deleted) {
            return res.status(404).json({ detail: 'Product not found' });
        }

        res.json({ detail: 'Product deleted successfully' });
    } catch (err) {
        next(err);
    }
};
