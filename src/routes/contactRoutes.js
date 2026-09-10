import { Router } from 'express';
import { createContactSubmission, getContactSubmissions } from '../controllers/contactController.js';
import { optionalAuth, authMiddleware } from '../middleware/auth.js';

const router = Router();

// POST /api/contact (Public or authenticated)
router.post('/', optionalAuth, createContactSubmission);

// GET /api/contact (View stored submissions)
router.get('/', optionalAuth, getContactSubmissions);

export default router;
