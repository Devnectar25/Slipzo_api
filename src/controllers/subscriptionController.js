import Subscription from '../models/Subscription.js';
import PrintLedger, { cleanPrintId } from '../models/PrintLedger.js';
import { v4 as uuidv4 } from 'uuid';
import PrintLock, { billKey, cleanHolder } from '../models/PrintLock.js';
import { query } from '../config/database.js';
import { priceForPrints, MIN_PRINTS, MAX_PRINTS } from '../utils/pricing.js';
import { verifyPayment, verifyRazorpaySignature, paymentsConfigured, unverifiedPaymentsAllowed, createOrder } from '../utils/razorpay.js';

/**
 * Authoritative server-side plan and price resolver.
 * Never trusts client-supplied `amount`, never lets client override DB `prints_count`,
 * and never infers time-based plans from arbitrary `plan_name` text.
 */
const resolvePlanPricing = async (body) => {
  const planId = body?.plan_id ? String(body.plan_id).trim() : '';
  const rawPlanName = body?.plan_name ? String(body.plan_name).trim() : '';

  if (planId || rawPlanName) {
    const pRows = await query(
      'SELECT * FROM plans WHERE (id = ? OR name = ?) AND status = ? LIMIT 1',
      [planId, rawPlanName, 'active']
    );
    if (pRows && pRows.length > 0) {
      const row = pRows[0];
      const price = Math.round(Number(row.price));
      if (!Number.isFinite(price) || price <= 0) {
        return { error: 'Invalid plan price configured.' };
      }
      const planType = row.plan_type === 'time' ? 'time' : 'print';
      const durationMonths = planType === 'time' ? Math.max(0, Number(row.duration_months || 0)) : 0;
      const prints = Math.max(0, Number(row.prints_count || 0));
      return {
        planRow: row,
        planId: row.id,
        planName: row.name,
        price,
        prints,
        planType,
        durationMonths
      };
    }
    if (planId) {
      return { error: 'Selected plan was not found or is inactive.' };
    }
  }

  // Custom print pack: strict server-side pricing only (no client amount fallback)
  const prints = Number(body?.prints_count);
  const price = priceForPrints(prints);
  if (price === null || !Number.isFinite(price) || price <= 0) {
    return { error: `Invalid plan or print count. Custom packs support ${MIN_PRINTS} to ${MAX_PRINTS} prints.` };
  }
  return {
    planRow: null,
    planId: null,
    planName: `Custom ${prints} Prints Pack`,
    price,
    prints,
    planType: 'print',
    durationMonths: 0
  };
};

// Step 1 of paying from the phone app: the server decides the price and opens a Razorpay order for it.
export const createPaymentOrder = async (req, res, next) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ detail: 'Please sign in to buy prints.' });
    }
    const resolved = await resolvePlanPricing(req.body);
    if (resolved.error) {
      return res.status(400).json({ detail: resolved.error });
    }
    const { price, prints, planName } = resolved;
    if (!paymentsConfigured()) {
      console.error('❌ RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set: cannot open a payment order');
      return res.status(503).json({ detail: 'Payment verification is not configured on the server.', code: 'NOT_CONFIGURED' });
    }
    const receipt = `slp_${Date.now().toString(36)}_${String(req.user.id).replace(/-/g, '').slice(0, 10)}`;
    const made = await createOrder(price, receipt, { user_id: String(req.user.id), prints: String(prints || 0), plan_name: String(planName || '').slice(0, 60) });
    if (!made.ok) {
      return res.status(502).json({ detail: made.detail, code: made.code });
    }
    res.json({
      order_id: made.order.id,
      amount: made.order.amount,
      currency: made.order.currency || 'INR',
      key_id: process.env.RAZORPAY_KEY_ID,
      prints_count: prints,
      price
    });
  } catch (err) {
    console.error('❌ Error creating payment order:', err);
    next(err);
  }
};

// Payment ids being confirmed right now. A second request for the same id waits out as "already used" instead of racing the first.
const confirming = new Set();

export const createSubscription = async (req, res, next) => {
  let lockedPaymentId = null;
  try {
    const { plan_name, payment_id } = req.body;

    if (!req.user?.id) {
      return res.status(401).json({ detail: 'Please sign in to buy prints.' });
    }
    if (!plan_name || typeof plan_name !== 'string' || plan_name.length > 80) {
      return res.status(400).json({ detail: 'Plan name is required' });
    }

    const resolved = await resolvePlanPricing(req.body);
    if (resolved.error) {
      return res.status(400).json({ detail: resolved.error });
    }
    const { planId, planName, price, prints, planType, durationMonths } = resolved;

    const paymentId = String(payment_id || '').trim();
    if (!paymentId) {
      return res.status(400).json({ detail: 'Payment id is required' });
    }

    if (confirming.has(paymentId)) {
      return res.status(409).json({ detail: 'This payment has already been used.', code: 'PAYMENT_IN_PROGRESS' });
    }
    confirming.add(paymentId);
    lockedPaymentId = paymentId;

    // One payment can only ever buy one pack
    const used = await query('SELECT id FROM subscriptions WHERE payment_id = ? LIMIT 1', [paymentId]);
    if (used && used.length > 0) {
      return res.status(409).json({ detail: 'This payment has already been used.', code: 'PAYMENT_USED' });
    }

    if (unverifiedPaymentsAllowed() && !paymentsConfigured()) {
      console.warn('⚠️ ALLOW_UNVERIFIED_PAYMENTS is on: recording a payment without checking it with Razorpay (development only)');
    } else {
      // A payment from the phone app's own screen comes with the order it was made for
      const orderId = /^order_[A-Za-z0-9]+$/.test(String(req.body.order_id || '')) ? String(req.body.order_id) : null;
      const signature = req.body?.razorpay_signature ? String(req.body.razorpay_signature).trim() : '';
      if (orderId && signature && paymentsConfigured() && !verifyRazorpaySignature(orderId, paymentId, signature)) {
        return res.status(402).json({ detail: 'Payment signature mismatch.', code: 'BAD_SIGNATURE' });
      }
      const check = await verifyPayment(paymentId, price, orderId);
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
        plan_id: planId,
        plan_type: planType,
        duration_months: durationMonths,
        plan_name: planName,
        amount: price,
        prints_count: prints,
        payment_id: paymentId,
        payment_status: 'completed'
      });
    } catch (createErr) {
      // The database refuses a second record for the same payment id
      if (createErr?.code === 'ER_DUP_ENTRY' || createErr?.code === '23505') {
        return res.status(409).json({ detail: 'This payment has already been used.', code: 'PAYMENT_USED' });
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
    const [subscriptions, quota] = await Promise.all([
      Subscription.findByUserId(userId),
      Subscription.getQuotaByUserId(userId)
    ]);
    // acting_shop: whose data this account works on right now (a worker: the owner's), so the app notices a change
    res.json({ subscriptions, quota, acting_shop: userId });
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
    // late: this print already came out, but its report could not reach the server then. It is counted either way.
    const late = req.body?.late === true;
    if (currentQuota.printsRemaining <= 0 && !late && !cleanPrintId(req.body?.print_id)) {
      return res.status(403).json({
        error: 'QUOTA_EXHAUSTED',
        detail: 'No prints available in your print quota. Please purchase a plan to continue printing.',
        quota: currentQuota
      });
    }

    // Counted on the shop, whoever of its people printed; a print reported twice is counted once
    const result = await PrintLedger.countOnce(userId, {
      printId: cleanPrintId(req.body?.print_id) || uuidv4(),
      workerId: req.authUser?.id,
      billId: req.body?.bill_id,
      device: req.body?.device,
      limit: currentQuota.hasActiveTimePlan || late ? null : Number(currentQuota.totalPrints) || 0
    });
    if (result === 'refused') {
      const quota = await Subscription.getQuotaByUserId(userId);
      return res.status(403).json({
        error: 'QUOTA_EXHAUSTED',
        code: 'QUOTA_EXHAUSTED',
        detail: 'No prints available in your print quota. Please purchase a plan to continue printing.',
        quota
      });
    }
    const holder = cleanHolder(req.body?.holder);
    if (holder && req.body?.bill_id) await PrintLock.creditUsed(userId, billKey(req.body.bill_id), holder);

    // read back, so the count includes what other devices used meanwhile
    const updatedQuota = await Subscription.getQuotaByUserId(userId);
    console.log(`🖨️ Print credit consumed: User [${userId}] | Remaining: ${updatedQuota.printsRemaining} | Used: ${updatedQuota.usedPrints}`);

    return res.status(200).json({
      success: true,
      message: 'Print credit consumed successfully',
      // the app may send the same print again when the answer gets lost: it is counted once
      counted_once: true,
      quota: updatedQuota
    });
  } catch (err) {
    console.error('❌ Error consuming print credit:', err);
    next(err);
  }
};
