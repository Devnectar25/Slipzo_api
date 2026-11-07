import express from 'express';
import { getShop, updateShop, uploadShopLogo } from '../controllers/shopController.js';
import { authMiddleware } from '../middleware/auth.js';
import { listStaff, inviteStaff, regenerateInvite, revokeStaff, joinShop, leaveShop } from '../controllers/staffController.js';

const router = express.Router();

router.use(authMiddleware);
router.get('/', getShop);
router.put('/', updateShop);
router.post('/upload-logo', uploadShopLogo);

router.get('/staff', listStaff);
router.post('/staff', inviteStaff);
router.post('/staff/join', joinShop);
router.post('/staff/leave', leaveShop);
router.post('/staff/:id/regenerate', regenerateInvite);
router.delete('/staff/:id', revokeStaff);

export default router;