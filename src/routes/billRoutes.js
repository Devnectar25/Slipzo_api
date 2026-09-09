import express from 'express';
import { getBills, createBill, getBill, getBillStats } from '../controllers/billController.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

router.use(authMiddleware);
router.get('/', getBills);
router.post('/', createBill);
router.get('/stats', getBillStats);
router.get('/:id', getBill);

export default router;