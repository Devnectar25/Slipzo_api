import express from 'express';
import { createSubscription, getUserSubscriptions, getAllSubscriptions } from '../controllers/subscriptionController.js';
import { optionalAuth, authMiddleware } from '../middleware/auth.js';
import { adminAuthMiddleware } from '../middleware/adminAuth.js';

const router = express.Router();

// Public / User subscription purchase route (uses optional auth so guests or logged in users can buy)
router.post('/', optionalAuth, createSubscription);

// Logged-in user's subscriptions
router.get('/my', authMiddleware, getUserSubscriptions);

// Admin view of all subscriptions
router.get('/all', adminAuthMiddleware, getAllSubscriptions);

export default router;
