import express from 'express';
import { createSubscription, getUserSubscriptions, getAllSubscriptions, claimOnboardingReward, consumePrint } from '../controllers/subscriptionController.js';
import { optionalAuth, authMiddleware } from '../middleware/auth.js';
import { adminAuthMiddleware } from '../middleware/adminAuth.js';

const router = express.Router();

// Claim 10 free prints onboarding reward (one-time duplicate-safe)
router.post('/claim-onboarding-reward', authMiddleware, claimOnboardingReward);

// Deduct 1 print credit on actual print operation
router.post('/consume-print', authMiddleware, consumePrint);

// Pack purchase: signed-in users only, and the payment is verified with Razorpay before any prints are granted
router.post('/', authMiddleware, createSubscription);

// Logged-in user's subscriptions
router.get('/my', authMiddleware, getUserSubscriptions);

// Admin view of all subscriptions
router.get('/all', adminAuthMiddleware, getAllSubscriptions);

export default router;
