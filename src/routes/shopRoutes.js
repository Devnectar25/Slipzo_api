import express from 'express';
import { getShop, updateShop, uploadShopLogo } from '../controllers/shopController.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

router.use(authMiddleware);
router.get('/', getShop);
router.put('/', updateShop);
router.post('/upload-logo', uploadShopLogo);

export default router;