import Subscription from '../models/Subscription.js';
import { query } from '../config/database.js';
import { priceForPrints, MIN_PRINTS, MAX_PRINTS } from '../utils/pricing.js';
import { verifyPayment, paymentsConfigured, unverifiedPaymentsAllowed } from '../utils/razorpay.js';

// Payment ids being confirmed right now. A second request for the same id waits out as "already used" instead of racing the first.
const confirming = new Set();

export const createSubscription = async (req, res, next) => {
  let lockedPaymentId = null;
  try {
    const { plan_name, prints_count, payment_id } = req.body;

    if (!req.user?.id) {
      return res.status(401).json({ detail: 'Please sign in to buy prints.' });
    }
    if (!plan_name || typeof plan_name !== 'string' || plan_name.length > 80) {
      return res.status(400).json({ detail: 'Plan name is required' });
    }

    // The server, not the browser, decides what a pack costs
    const prints = Number(prints_count);
    const price = priceForPrints(prints);
    if (price === null) {
      return res.status(400).json({ detail: `Pack size must be a whole number between ${MIN_PRINTS} and ${MAX_PRINTS} prints.` });
    }

    const paymentId = String(payment_id || '').trim();
    if (!paymentId) {
      return res.status(400).json({ detail: 'Payment id is required' });
    }

    if (confirming.has(paymentId)) {
      return res.status(409).json({ detail: 'This payment has already been used.' });
    }
    confirming.add(paymentId);
    lockedPaymentId = paymentId;

    // One payment can only ever buy one pack
    const used = await query('SELECT id FROM subscriptions WHERE payment_id = ? LIMIT 1', [paymentId]);
    if (used && used.length > 0) {
      return res.status(409).json({ detail: 'This payment has already been used.' });
    }

    if (unverifiedPaymentsAllowed() && !paymentsConfigured()) {
      console.warn('⚠️ ALLOW_UNVERIFIED_PAYMENTS is on: recording a payment without checking it with Razorpay (development only)');
    } else {
      const check = await verifyPayment(paymentId, price);
      if (!check.ok) {
        const status = check.code === 'NOT_CONFIGURED' ? 503 : check.code === 'GATEWAY_UNREACHABLE' ? 502 : 402;
        if (check.code === 'NOT_CONFIGURED') console.error('❌ RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set: refusing to grant prints for an unverified payment');
        return res.status(status).json({ detail: check.detail, code: check.code });
      }
    }

    let subscription;
    try {
      subscription = await Subscription.create({
      user_id: req.user.id,
      user_name: req.user.name || 'Slipzen Member',
      user_email: req.user.email,
      plan_name,
      amount: price,
      prints_count: prints,
      payment_id: paymentId,
      payment_status: 'completed'
      });
    } catch (createErr) {
      // The database refuses a second record for the same payment id
      if (createErr?.code === 'ER_DUP_ENTRY' || createErr?.code === '23505') {
        return res.status(409).json({ detail: 'This payment has already been used.' });
      }
      throw createErr;
    }

    const quota = await Subscription.getQuotaByUserId(req.user.id);
    console.log(`💳 Subscription recorded: user ${req.user.id} bought ${prints} prints for ₹${price}`);

    res.status(201).json({
      message: 'Subscription payment stored successfully in database',
      subscription,
      quota
    });
  } catch (err) {
    console.error('❌ Error saving subscription to database:', err);
    next(err);
  } finally {
    if (lockedPaymentId) confirming.delete(lockedPaymentId);
  }
};

export const getUserSubscriptions = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ detail: 'Authentication required' });
    }
    const subscriptions = await Subscription.findByUserId(userId);
    const quota = await Subscription.getQuotaByUserId(userId);
    res.json({ subscriptions, quota });
  } catch (err) {
    next(err);
  }
};

export const getAllSubscriptions = async (req, res, next) => {
  try {
    const subscriptions = await Subscription.findAll();
    res.json({ subscriptions });
  } catch (err) {
    next(err);
  }
};

// Marks account setup as finished. No prints are given for this any more; a pack has to be bought first.
export const claimOnboardingReward = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ detail: 'Authentication required' });
    }

    // Check if user exists and current onboarding status
    const users = await query('SELECT id, email, onboarding_reward_claimed FROM users WHERE id = ?', [userId]);
    if (!users || users.length === 0) {
      return res.status(404).json({ detail: 'User not found' });
    }

    const isAlreadyClaimed = Number(users[0].onboarding_reward_claimed || 0) >= 1;
    if (isAlreadyClaimed) {
      const quota = await Subscription.getQuotaByUserId(userId);
      return res.status(200).json({
        success: false,
        alreadyClaimed: true,
        printsCredited: 0,
        message: 'Setup is already finished for this account.',
        quota
      });
    }

    // Setup cannot be finished before a pack has been bought (this is what keeps the plan step from being skipped)
    const before = await Subscription.getQuotaByUserId(userId);
    if (before.isFreeTier) {
      return res.status(402).json({ detail: 'Please choose a plan before finishing setup.', code: 'PLAN_REQUIRED' });
    }

    // 2 = setup finished, no free prints (1 is only for accounts that got the old free prints)
    await query(
      'UPDATE users SET onboarding_reward_claimed = 2 WHERE id = ? AND (onboarding_reward_claimed = 0 OR onboarding_reward_claimed IS NULL)',
      [userId]
    );

    const quota = await Subscription.getQuotaByUserId(userId);

    console.log(`✅ Setup finished: user [${users[0].email} / ${userId}]. Prints remaining: ${quota.printsRemaining}`);

    return res.status(200).json({
      success: true,
      alreadyClaimed: false,
      printsCredited: 0,
      message: 'Setup finished.',
      quota
    });
  } catch (err) {
    console.error('❌ Error claiming onboarding reward:', err);
    next(err);
  }
};

export const consumePrint = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ detail: 'Authentication required' });
    }

    const currentQuota = await Subscription.getQuotaByUserId(userId);
    if (currentQuota.printsRemaining <= 0) {
      return res.status(403).json({
        error: 'QUOTA_EXHAUSTED',
        detail: 'No prints available in your print quota. Please purchase a plan to continue printing.',
        quota: currentQuota
      });
    }

    // Atomically increment prints_used in users table
    await query(
      'UPDATE users SET prints_used = COALESCE(prints_used, 0) + 1 WHERE id = ?',
      [userId]
    );

    const updatedQuota = await Subscription.getQuotaByUserId(userId);
    console.log(`🖨️ Print credit consumed: User [${userId}] | Remaining: ${updatedQuota.printsRemaining} | Used: ${updatedQuota.usedPrints}`);

    return res.status(200).json({
      success: true,
      message: 'Print credit consumed successfully',
      quota: updatedQuota
    });
  } catch (err) {
    console.error('❌ Error consuming print credit:', err);
    next(err);
  }
};
