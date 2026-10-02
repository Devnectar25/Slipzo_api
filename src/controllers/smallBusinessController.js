import SmallBusiness from '../models/SmallBusiness.js';

/**
 * GET /api/small-business/products or /api/small-business
 * Retrieves products directly from the `small_business` table (100 products)
 */
export const getSmallBusinessProducts = async (req, res, next) => {
    try {
        const { search, category, page, limit } = req.query;
        const userId = req.user?.id;

        if (userId) {
            const catalog = await SmallBusiness.findCatalogForUser(userId, search || '', category || 'all');
            return res.json({
                products: catalog,
                total: catalog.length
            });
        }

        const result = await SmallBusiness.findAll({
            search: search || '',
            category: category || 'all',
            page: parseInt(page) || 1,
            limit: parseInt(limit) || 100
        });

        res.json({
            products: result.items,
            total: result.total,
            page: result.page,
            limit: result.limit,
            totalPages: result.totalPages
        });
    } catch (err) {
        next(err);
    }
};

/**
 * GET /api/small-business/products/:id
 */
export const getSmallBusinessProductById = async (req, res, next) => {
    try {
        const { id } = req.params;
        const product = await SmallBusiness.findById(id);
        if (!product) {
            return res.status(404).json({ detail: 'Product not found in small_business catalog' });
        }
        res.json(product);
    } catch (err) {
        next(err);
    }
};
