import { Router } from 'express';
import { createContactSubmission, getContactSubmissions } from '../controllers/contactController.js';
import { optionalAuth } from '../middleware/auth.js';
import { adminAuthMiddleware, adminCan } from '../middleware/adminAuth.js';
import { publicFormLimiter } from '../config/security.js';

const router = Router();

// POST /api/contact (Public or authenticated, rate-limited)
router.post('/', publicFormLimiter, optionalAuth, createContactSubmission);

// GET /api/contact (Admin only)
router.get('/', adminAuthMiddleware, adminCan('contacts'), getContactSubmissions);

export default router;
