import Subscription from '../models/Subscription.js';
import { query } from '../config/database.js';

export const createSubscription = async (req, res, next) => {
  try {
    const { plan_name, amount, prints_count, payment_id, payment_status, user_name, user_email } = req.body;

    if (!plan_name) {
      return res.status(400).json({ detail: 'Plan name is required' });
    }

    const userId = req.user?.id || 'guest';
    const email = req.user?.email || user_email || 'user@slipzo.com';
    const name = req.user?.name || user_name || 'Valued Slipzo Customer';

    const subscription = await Subscription.create({
      user_id: userId,
      user_name: name,
      user_email: email,
      plan_name,
      amount: amount || 0,
      prints_count: prints_count || 0,
      payment_id: payment_id || `PAY_${Date.now()}`,
      payment_status: payment_status || 'completed'
    });

    const quota = await Subscription.getQuotaByUserId(userId);

    console.log(`💳 New Subscription recorded in DB: User [${email}] bought [${plan_name}] for ₹${amount} (${prints_count} prints). Updated remaining prints: ${quota.printsRemaining}`);

    res.status(201).json({
      message: 'Subscription payment stored successfully in database',
      subscription,
      quota
    });
  } catch (err) {
    console.error('❌ Error saving subscription to database:', err);
    next(err);
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

    const isAlreadyClaimed = Number(users[0].onboarding_reward_claimed || 0) === 1;
    if (isAlreadyClaimed) {
      const quota = await Subscription.getQuotaByUserId(userId);
      return res.status(200).json({
        success: false,
        alreadyClaimed: true,
        printsCredited: 0,
        message: 'Onboarding reward has already been claimed for this account.',
        quota
      });
    }

    // Atomically set onboarding_reward_claimed = 1 only if it is currently 0 or NULL
    await query(
      'UPDATE users SET onboarding_reward_claimed = 1 WHERE id = ? AND (onboarding_reward_claimed = 0 OR onboarding_reward_claimed IS NULL)',
      [userId]
    );

    const quota = await Subscription.getQuotaByUserId(userId);

    console.log(`🎉 Onboarding reward claimed: User [${users[0].email} / ${userId}] was credited 10 free prints. Current printsRemaining: ${quota.printsRemaining}`);

    return res.status(200).json({
      success: true,
      alreadyClaimed: false,
      printsCredited: 10,
      message: '10 free prints onboarding reward credited successfully!',
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
