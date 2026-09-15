import Subscription from '../models/Subscription.js';

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
