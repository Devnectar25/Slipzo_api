import express from 'express';
import { getTemplates, createTemplate, duplicateTemplate, deleteTemplate } from '../controllers/templateController.js';
import { authMiddleware, optionalAuth } from '../middleware/auth.js';

const router = express.Router();

router.get('/', optionalAuth, getTemplates);
router.post('/', authMiddleware, createTemplate);
router.post('/:id/duplicate', authMiddleware, duplicateTemplate);
router.delete('/:id', authMiddleware, deleteTemplate);

export default router;