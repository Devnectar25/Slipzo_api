import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { getTables, updateTable, resetTable, resetAllTables, setupTables } from '../controllers/restaurantTableController.js';

const router = express.Router();

router.use(authMiddleware);

// Supports both direct paths and sub-paths
router.get('/', getTables);
router.get('/tables', getTables);

router.put('/:id', updateTable);
router.put('/tables/:id', updateTable);

router.post('/reset-all', resetAllTables);
router.post('/tables/reset-all', resetAllTables);

router.post('/reset/:id', resetTable);
router.post('/tables/reset/:id', resetTable);

router.post('/setup', setupTables);
router.post('/tables/setup', setupTables);

export default router;
