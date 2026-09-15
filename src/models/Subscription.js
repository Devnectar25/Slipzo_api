import { query } from '../config/database.js';
import { v4 as uuidv4 } from 'uuid';

class Subscription {
  static async create({ user_id, user_name, user_email, plan_name, amount, prints_count, payment_id, payment_status = 'completed' }) {
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

    // Fallback if no matching registered user found: use first registered user or null
    if (!validUserId) {
      const firstUser = await query('SELECT id FROM users LIMIT 1').catch(() => []);
      if (firstUser && firstUser.length > 0) validUserId = firstUser[0].id;
    }

    const sql = `
      INSERT INTO subscriptions (
        id, user_id, user_name, user_email, plan_name, amount, prints_count, payment_id, payment_status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `;
    const params = [
      id,
      validUserId || 'system',
      user_name || 'Paid User',
      user_email || 'user@slipzo.com',
      plan_name || 'Pro Plan',
      parseFloat(amount || 0),
      parseInt(prints_count || 0),
      payment_id || `PAY_${Date.now()}`,
      payment_status || 'completed'
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
        activePlanName: 'Free Starter Tier'
      };
    }

    try {
      // 1. Get total purchased prints from subscriptions table
      const subRows = await query(
        `SELECT SUM(prints_count) as total_purchased, MAX(plan_name) as latest_plan 
         FROM subscriptions 
         WHERE user_id = ? AND (payment_status = 'completed' OR payment_status IS NULL)`,
        [userId]
      ).catch(() => []);

      const purchasedPrints = Number(subRows[0]?.total_purchased || 0);
      const latestPlan = subRows[0]?.latest_plan || null;

      // 2. Base free starter prints = 10
      const totalPrints = 10 + purchasedPrints;

      // 3. Count total bills created by this user in database
      const billRows = await query(
        `SELECT COUNT(*) as used_count FROM bills WHERE user_id = ?`,
        [userId]
      ).catch(() => []);

      const usedPrints = Number(billRows[0]?.used_count || 0);
      const printsRemaining = Math.max(0, totalPrints - usedPrints);

      return {
        totalPrints,
        usedPrints,
        printsRemaining,
        availablePrints: printsRemaining,
        isFreeTier: purchasedPrints === 0,
        activePlanName: latestPlan || (purchasedPrints > 0 ? 'Active Plan' : 'Free Starter Tier')
      };
    } catch (err) {
      console.error('Error computing quota for user:', userId, err);
      return {
        totalPrints: 10,
        usedPrints: 0,
        printsRemaining: 10,
        availablePrints: 10,
        isFreeTier: true,
        activePlanName: 'Free Starter Tier'
      };
    }
  }
}

export default Subscription;
