import { query } from '../config/database.js';
import { v4 as uuidv4 } from 'uuid';

class Subscription {
  static async create({
    user_id,
    user_name,
    user_email,
    plan_name,
    amount,
    prints_count,
    payment_id,
    payment_status = 'completed',
    plan_id = null,
    plan_type = 'print',
    duration_months = 0,
    expires_at = null
  }) {
    const id = `sub_${uuidv4().replace(/-/g, '').substring(0, 16)}`;
    
    // Resolve user_id against existing users table if possible
    let validUserId = null;
    if (user_id && user_id !== 'guest') {
      const check = await query('SELECT id FROM users WHERE id = ? LIMIT 1', [user_id]).catch(() => []);
      if (check && check.length > 0) validUserId = check[0].id;
    }
    if (!validUserId && user_email) {
      const checkEmail = await query('SELECT id FROM users WHERE LOWER(email) = ? LIMIT 1', [user_email.toLowerCase().trim()]).catch(() => []);
      if (checkEmail && checkEmail.length > 0) validUserId = checkEmail[0].id;
    }

    // Auto-compute expires_at for time plans (extends existing validity if still active)
    let calculatedExpiresAt = expires_at;
    if (!calculatedExpiresAt && (plan_type === 'time' || duration_months > 0 || /month|year/i.test(plan_name || ''))) {
      let months = Number(duration_months || 0);
      if (!months) {
        if (/1\s*year/i.test(plan_name)) months = 12;
        else if (/3\s*month/i.test(plan_name)) months = 3;
        else months = 1;
      }
      const now = new Date();
      let baseDate = now;
      if (validUserId) {
        const existing = await query(
          `SELECT expires_at FROM subscriptions WHERE user_id = ? AND expires_at > CURRENT_TIMESTAMP ORDER BY expires_at DESC LIMIT 1`,
          [validUserId]
        ).catch(() => []);
        if (existing && existing[0]?.expires_at) {
          const prevExp = new Date(existing[0].expires_at);
          if (prevExp > now) baseDate = prevExp;
        }
      }
      const exp = new Date(baseDate.getTime());
      exp.setDate(exp.getDate() + months * 30);
      calculatedExpiresAt = exp.toISOString();
    }

    const sql = `
      INSERT INTO subscriptions (
        id, user_id, user_name, user_email, plan_name, amount, prints_count,
        payment_id, payment_status, plan_id, plan_type, duration_months, expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `;
    const params = [
      id,
      validUserId || 'system',
      user_name || 'Paid User',
      user_email || 'user@slipzen.com',
      plan_name || 'Pro Plan',
      parseFloat(amount || 0),
      parseInt(prints_count || 0),
      payment_id || `PAY_${Date.now()}`,
      payment_status || 'completed',
      plan_id || null,
      plan_type || 'print',
      parseInt(duration_months || 0),
      calculatedExpiresAt || null
    ];
    await query(sql, params);
    return this.findById(id);
  }

  static async findById(id) {
    const rows = await query('SELECT * FROM subscriptions WHERE id = ?', [id]);
    return rows[0] || null;
  }

  static async findByUserId(userId) {
    const sql = 'SELECT * FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC';
    return await query(sql, [userId]);
  }

  static async findAll() {
    const sql = `
      SELECT 
        s.*,
        COALESCE(u.name, s.user_name) as registered_user_name,
        COALESCE(u.email, s.user_email) as registered_user_email,
        sh.name as shop_name,
        sh.phone as shop_phone
      FROM subscriptions s
      LEFT JOIN users u ON u.id = s.user_id
      LEFT JOIN shops sh ON sh.user_id = s.user_id
      ORDER BY s.created_at DESC
    `;
    return await query(sql);
  }

  static async getQuotaByUserId(userId) {
    if (!userId || userId === 'guest') {
      return {
        totalPrints: 10,
        usedPrints: 0,
        printsRemaining: 10,
        availablePrints: 10,
        isFreeTier: true,
        activePlanName: 'Free Starter Tier',
        onboardingRewardClaimed: true,
        planType: 'print',
        expiresAt: null,
        daysRemaining: null,
        isExpiringSoon: false,
        isExpired: false,
        hasActiveTimePlan: false
      };
    }

    try {
      // 1. Check user record for onboarding reward and prints_used
      const userRows = await query(
        `SELECT onboarding_reward_claimed, prints_used FROM users WHERE id = ?`,
        [userId]
      ).catch(() => []);
      const onboardingValue = Number(userRows[0]?.onboarding_reward_claimed || 0);
      const onboardingDone = onboardingValue >= 1;
      const rewardClaimed = onboardingValue === 1;
      const usedPrints = Math.max(0, Number(userRows[0]?.prints_used || 0));

      // 2. Get total purchased prints from subscriptions table
      const subRows = await query(
        `SELECT SUM(prints_count) as total_purchased, MAX(plan_name) as latest_plan 
         FROM subscriptions 
         WHERE user_id = ? AND (payment_status = 'completed' OR payment_status IS NULL)`,
        [userId]
      ).catch(() => []);

      const purchasedPrints = Number(subRows[0]?.total_purchased || 0);
      const latestPlan = subRows[0]?.latest_plan || null;

      // 3. Check for Time-based subscriptions and calculate expiry
      const timeSubs = await query(
        `SELECT * FROM subscriptions 
         WHERE user_id = ? AND (payment_status = 'completed' OR payment_status IS NULL)
         AND (plan_type = 'time' OR plan_name LIKE '%Month%' OR plan_name LIKE '%Year%')
         ORDER BY created_at DESC LIMIT 5`,
        [userId]
      ).catch(() => []);

      let hasActiveTimePlan = false;
      let expiresAt = null;
      let daysRemaining = null;
      let isExpiringSoon = false;
      let isExpired = false;
      let activeTimePlanName = null;

      if (timeSubs && timeSubs.length > 0) {
        for (const sub of timeSubs) {
          let subExp = sub.expires_at ? new Date(sub.expires_at) : null;
          if (!subExp && sub.created_at) {
            const createdAt = new Date(sub.created_at);
            let months = Number(sub.duration_months || 0);
            if (!months) {
              if (/1\s*year/i.test(sub.plan_name)) months = 12;
              else if (/3\s*month/i.test(sub.plan_name)) months = 3;
              else if (/1\s*month/i.test(sub.plan_name)) months = 1;
            }
            if (months > 0) {
              subExp = new Date(createdAt.getTime());
              subExp.setDate(subExp.getDate() + months * 30);
            }
          }

          if (subExp) {
            const now = new Date();
            const diffMs = subExp.getTime() - now.getTime();
            // Calculate exact days left
            const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

            if (!expiresAt || subExp > new Date(expiresAt)) {
              expiresAt = subExp.toISOString();
              daysRemaining = diffDays;
              activeTimePlanName = sub.plan_name;
              hasActiveTimePlan = diffDays >= 0;
              isExpired = diffDays < 0;
              isExpiringSoon = diffDays >= 0 && diffDays <= 3;
            }
          }
        }
      }

      // 4. Print quota calculation
      const baseFreePrints = rewardClaimed ? 10 : 0;
      const totalPrints = hasActiveTimePlan ? Math.max(99999, baseFreePrints + purchasedPrints) : (baseFreePrints + purchasedPrints);
      const printsRemaining = hasActiveTimePlan ? 99999 : Math.max(0, totalPrints - usedPrints);

      return {
        totalPrints,
        usedPrints,
        printsRemaining,
        availablePrints: printsRemaining,
        isFreeTier: !hasActiveTimePlan && purchasedPrints === 0,
        activePlanName: hasActiveTimePlan
          ? activeTimePlanName
          : (latestPlan || (purchasedPrints > 0 ? 'Active Plan' : (rewardClaimed ? 'Free Starter Tier' : (onboardingDone ? 'No Plan' : 'New Account (Pending Setup)')))),
        onboardingRewardClaimed: onboardingDone,
        // Time plan Jio/Airtel style expiry fields:
        planType: (hasActiveTimePlan || timeSubs.length > 0) ? 'time' : 'print',
        expiresAt,
        daysRemaining,
        isExpiringSoon,
        isExpired,
        hasActiveTimePlan
      };
    } catch (err) {
      console.error('Error computing quota for user:', userId, err);
      return {
        totalPrints: 10,
        usedPrints: 0,
        printsRemaining: 10,
        availablePrints: 10,
        isFreeTier: true,
        activePlanName: 'Free Starter Tier',
        onboardingRewardClaimed: false,
        planType: 'print',
        expiresAt: null,
        daysRemaining: null,
        isExpiringSoon: false,
        isExpired: false,
        hasActiveTimePlan: false
      };
    }
  }
}

export default Subscription;
