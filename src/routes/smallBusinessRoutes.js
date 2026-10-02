import express from 'express';
import {
    getSmallBusinessProducts,
    getSmallBusinessProductById
} from '../controllers/smallBusinessController.js';
import { optionalAuth } from '../middleware/auth.js';

const router = express.Router();

router.get('/products', optionalAuth, getSmallBusinessProducts);
router.get('/products/:id', optionalAuth, getSmallBusinessProductById);
router.get('/', optionalAuth, getSmallBusinessProducts);

export default router;
