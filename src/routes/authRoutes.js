import express from 'express';
import { checkAvailability, register, login, logout, getMe } from '../controllers/authController.js';
import { authMiddleware } from '../middleware/auth.js';
import { sendOtp, verifyOtp, resetPassword } from '../controllers/otpController.js';

const router = express.Router();

router.post('/check-availability', checkAvailability);
router.post('/register', register);
router.post('/login', login);
router.post('/logout', logout);
router.get('/me', authMiddleware, getMe);

// Two-step check with a code sent to the phone (sign up and forgot password)
router.post('/otp/send', sendOtp);
router.post('/otp/verify', verifyOtp);
router.post('/password/reset', resetPassword);

export default router;