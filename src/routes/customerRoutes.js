import express from 'express';
import {
    getCustomers,
    getCustomerStats,
    getCustomer,
    createCustomer,
    updateCustomer,
    deleteCustomer,
    getCustomerBills
} from '../controllers/customerController.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

router.use(authMiddleware);

router.get('/', getCustomers);
router.get('/stats', getCustomerStats);
router.post('/', createCustomer);
router.get('/:id', getCustomer);
router.put('/:id', updateCustomer);
router.delete('/:id', deleteCustomer);
router.get('/:id/bills', getCustomerBills);

export default router;
