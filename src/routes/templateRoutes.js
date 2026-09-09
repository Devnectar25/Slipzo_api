import express from 'express';
import { getTemplates, createTemplate, duplicateTemplate, deleteTemplate } from '../controllers/templateController.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

router.use(authMiddleware);
router.get('/', getTemplates);
router.post('/', createTemplate);
router.post('/:id/duplicate', duplicateTemplate);
router.delete('/:id', deleteTemplate);

export default router;