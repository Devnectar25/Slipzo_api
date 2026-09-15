import express from 'express';
import { getBills, createBill, getBill, getBillStats, deleteBill } from '../controllers/billController.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

router.use(authMiddleware);
router.get('/', getBills);
router.post('/', createBill);
router.get('/stats', getBillStats);
router.get('/:id', getBill);
router.delete('/:id', deleteBill);

export default router;