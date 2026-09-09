import express from 'express';
import { getShop, updateShop } from '../controllers/shopController.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

router.use(authMiddleware);
router.get('/', getShop);
router.put('/', updateShop);

export default router;