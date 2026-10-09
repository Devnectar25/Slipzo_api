import express from 'express';
import { getBills, createBill, getBill, updateBill, getBillStats, deleteBill, markBillAsPrinted, markTableBillsAsPrinted } from '../controllers/billController.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

router.use(authMiddleware);
router.get('/', getBills);
router.post('/', createBill);
router.get('/stats', getBillStats);
router.post('/print-table/:tableNumber', markTableBillsAsPrinted);
router.post('/:id/print', markBillAsPrinted);
router.get('/:id', getBill);
router.put('/:id', updateBill);
router.delete('/:id', deleteBill);

export default router;