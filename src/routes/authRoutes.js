import express from 'express';
import { checkAvailability, register, login, logout, getMe } from '../controllers/authController.js';
import { authMiddleware } from '../middleware/auth.js';
import { sendOtp, verifyOtp, resetPassword } from '../controllers/otpController.js';
import { authStrictLimiter } from '../config/security.js';

const router = express.Router();

router.post('/check-availability', authStrictLimiter, checkAvailability);
router.post('/register', authStrictLimiter, register);
router.post('/login', authStrictLimiter, login);
router.post('/logout', logout);
router.get('/me', authMiddleware, getMe);

// Two-step check with a code sent to the phone (sign up and forgot password)
router.post('/otp/send', authStrictLimiter, sendOtp);
router.post('/otp/verify', authStrictLimiter, verifyOtp);
router.post('/password/reset', authStrictLimiter, resetPassword);

export default router;