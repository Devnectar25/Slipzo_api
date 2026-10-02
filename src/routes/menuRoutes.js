import express from 'express';
import {
    getMenuItems,
    getCatalogItems,
    createMenuItem,
    updateMenuItem,
    deleteMenuItem,
    clearUserMenu,
    lookupByBarcode
} from '../controllers/menuController.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

router.use(authMiddleware);

router.get('/', getMenuItems);
router.get('/catalog', getCatalogItems);
router.get('/barcode/:barcode', lookupByBarcode);
router.post('/', createMenuItem);
router.put('/:id', updateMenuItem);
router.delete('/:id', deleteMenuItem);
router.delete('/', clearUserMenu);

export default router;
