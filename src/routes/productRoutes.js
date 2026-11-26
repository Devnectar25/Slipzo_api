import express from 'express';
import {
    getProducts,
    getProductStats,
    getProduct,
    createProduct,
    updateProduct,
    deleteProduct
} from '../controllers/productController.js';
import { authMiddleware, optionalAuth } from '../middleware/auth.js';
import { adminAuthMiddleware, adminCan } from '../middleware/adminAuth.js';

const router = express.Router();

router.get('/', optionalAuth, getProducts);
router.get('/stats', optionalAuth, getProductStats);
router.get('/:id', authMiddleware, getProduct);

// Global hardware/store catalog mutations are admin-only
router.post('/', adminAuthMiddleware, adminCan('products'), createProduct);
router.put('/:id', adminAuthMiddleware, adminCan('products'), updateProduct);
router.delete('/:id', adminAuthMiddleware, adminCan('products'), deleteProduct);

export default router;
