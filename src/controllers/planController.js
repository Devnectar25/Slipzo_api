import { query } from '../config/database.js';

// Helper to safely parse features JSON
const parseFeatures = (feat) => {
  if (Array.isArray(feat)) return feat;
  if (!feat) return [];
  try {
    const parsed = JSON.parse(feat);
    return Array.isArray(parsed) ? parsed : [String(feat)];
  } catch (_) {
    return String(feat).split('\n').map(s => s.trim()).filter(Boolean);
  }
};

/**
 * Public endpoint: Returns all active plans grouped / sorted for users
 * GET /api/subscriptions/plans (or /api/plans)
 */
export const getPublicPlans = async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT * FROM plans WHERE status = 'active' ORDER BY sort_order ASC, created_at ASC`
    );

    const plans = (rows || []).map(p => ({
      ...p,
      price: Number(p.price || 0),
      original_price: p.original_price ? Number(p.original_price) : null,
      prints_count: Number(p.prints_count || 0),
      duration_months: Number(p.duration_months || 0),
      is_popular: Boolean(p.is_popular === true || p.is_popular === 1 || p.is_popular === '1'),
      features: parseFeatures(p.features)
    }));

    const timePlans = plans.filter(p => p.plan_type === 'time');
    const printPlans = plans.filter(p => p.plan_type === 'print');

    return res.json({
      success: true,
      plans,
      timePlans,
      printPlans
    });
  } catch (err) {
    console.error('❌ Error fetching public plans:', err);
    next(err);
  }
};

/**
 * Admin endpoint: Returns all plans (active & inactive) with summary stats
 * GET /api/admin/plans
 */
export const getAdminPlans = async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT * FROM plans ORDER BY plan_type DESC, sort_order ASC, created_at DESC`
    );

    const plans = (rows || []).map(p => ({
      ...p,
      price: Number(p.price || 0),
      original_price: p.original_price ? Number(p.original_price) : null,
      prints_count: Number(p.prints_count || 0),
      duration_months: Number(p.duration_months || 0),
      is_popular: Boolean(p.is_popular === true || p.is_popular === 1 || p.is_popular === '1'),
      features: parseFeatures(p.features)
    }));

    const stats = {
      totalPlans: plans.length,
      timePlansCount: plans.filter(p => p.plan_type === 'time').length,
      printPlansCount: plans.filter(p => p.plan_type === 'print').length,
      activePlansCount: plans.filter(p => p.status === 'active').length,
      inactivePlansCount: plans.filter(p => p.status !== 'active').length
    };

    return res.json({
      success: true,
      stats,
      plans
    });
  } catch (err) {
    console.error('❌ Error fetching admin plans:', err);
    next(err);
  }
};

/**
 * Admin endpoint: Create a new plan (Time-based or Print-based)
 * POST /api/admin/plans
 */
export const createPlan = async (req, res, next) => {
  try {
    const {
      name,
      plan_type = 'print',
      duration_months = 0,
      duration_label = '',
      prints_count = 0,
      price,
      original_price = null,
      description = '',
      features = [],
      is_popular = false,
      status = 'active',
      sort_order = 0
    } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ detail: 'Plan name is required' });
    }

    const numPrice = Number(price);
    if (isNaN(numPrice) || numPrice < 0) {
      return res.status(400).json({ detail: 'Valid plan price is required' });
    }

    const type = plan_type === 'time' ? 'time' : 'print';
    const id = `${type}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const featuresJson = typeof features === 'string' ? features : JSON.stringify(features || []);
    const popularVal = Boolean(is_popular) ? 1 : 0;
    const cleanDurationMonths = Number(duration_months) || 0;
    const cleanPrintsCount = Number(prints_count) || 0;
    const cleanOrigPrice = original_price ? Number(original_price) : null;
    const cleanSortOrder = Number(sort_order) || 0;

    await query(
      `INSERT INTO plans (
        id, name, plan_type, duration_months, duration_label, prints_count,
        price, original_price, description, features, is_popular, status, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        name.trim(),
        type,
        cleanDurationMonths,
        duration_label || (type === 'time' ? `${cleanDurationMonths} Month${cleanDurationMonths > 1 ? 's' : ''}` : 'Pay Per Print'),
        cleanPrintsCount,
        numPrice,
        cleanOrigPrice,
        description.trim(),
        featuresJson,
        popularVal,
        status || 'active',
        cleanSortOrder
      ]
    );

    const createdRows = await query(`SELECT * FROM plans WHERE id = ? LIMIT 1`, [id]);
    const created = createdRows?.[0] ? {
      ...createdRows[0],
      price: Number(createdRows[0].price),
      original_price: createdRows[0].original_price ? Number(createdRows[0].original_price) : null,
      prints_count: Number(createdRows[0].prints_count || 0),
      duration_months: Number(createdRows[0].duration_months || 0),
      is_popular: Boolean(createdRows[0].is_popular),
      features: parseFeatures(createdRows[0].features)
    } : null;

    console.log(`✅ Admin created plan [${id}] "${name}" (${type}, ₹${numPrice})`);
    return res.status(201).json({
      success: true,
      message: 'Plan created successfully',
      plan: created
    });
  } catch (err) {
    console.error('❌ Error creating plan:', err);
    next(err);
  }
};

/**
 * Admin endpoint: Update an existing plan
 * PUT /api/admin/plans/:id
 */
export const updatePlan = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ detail: 'Plan ID is required' });

    const existingRows = await query(`SELECT * FROM plans WHERE id = ? LIMIT 1`, [id]);
    if (!existingRows || existingRows.length === 0) {
      return res.status(404).json({ detail: 'Plan not found' });
    }

    const {
      name,
      plan_type,
      duration_months,
      duration_label,
      prints_count,
      price,
      original_price,
      description,
      features,
      is_popular,
      status,
      sort_order
    } = req.body;

    const current = existingRows[0];
    const newName = name !== undefined ? String(name).trim() : current.name;
    const newType = plan_type !== undefined ? (plan_type === 'time' ? 'time' : 'print') : current.plan_type;
    const newPrice = price !== undefined ? Number(price) : Number(current.price);
    const newOrigPrice = original_price !== undefined ? (original_price ? Number(original_price) : null) : (current.original_price ? Number(current.original_price) : null);
    const newDurationMonths = duration_months !== undefined ? Number(duration_months) : Number(current.duration_months || 0);
    const newDurationLabel = duration_label !== undefined ? String(duration_label) : current.duration_label;
    const newPrintsCount = prints_count !== undefined ? Number(prints_count) : Number(current.prints_count || 0);
    const newDesc = description !== undefined ? String(description).trim() : (current.description || '');
    const newFeatures = features !== undefined ? (typeof features === 'string' ? features : JSON.stringify(features)) : current.features;
    const newPopular = is_popular !== undefined ? (Boolean(is_popular) ? 1 : 0) : current.is_popular;
    const newStatus = status !== undefined ? String(status) : current.status;
    const newSortOrder = sort_order !== undefined ? Number(sort_order) : Number(current.sort_order || 0);

    await query(
      `UPDATE plans SET
        name = ?,
        plan_type = ?,
        duration_months = ?,
        duration_label = ?,
        prints_count = ?,
        price = ?,
        original_price = ?,
        description = ?,
        features = ?,
        is_popular = ?,
        status = ?,
        sort_order = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
      [
        newName,
        newType,
        newDurationMonths,
        newDurationLabel,
        newPrintsCount,
        newPrice,
        newOrigPrice,
        newDesc,
        newFeatures,
        newPopular,
        newStatus,
        newSortOrder,
        id
      ]
    );

    const updatedRows = await query(`SELECT * FROM plans WHERE id = ? LIMIT 1`, [id]);
    const updated = updatedRows?.[0] ? {
      ...updatedRows[0],
      price: Number(updatedRows[0].price),
      original_price: updatedRows[0].original_price ? Number(updatedRows[0].original_price) : null,
      prints_count: Number(updatedRows[0].prints_count || 0),
      duration_months: Number(updatedRows[0].duration_months || 0),
      is_popular: Boolean(updatedRows[0].is_popular),
      features: parseFeatures(updatedRows[0].features)
    } : null;

    console.log(`✅ Admin updated plan [${id}] "${newName}"`);
    return res.json({
      success: true,
      message: 'Plan updated successfully',
      plan: updated
    });
  } catch (err) {
    console.error('❌ Error updating plan:', err);
    next(err);
  }
};

/**
 * Admin endpoint: Delete plan
 * DELETE /api/admin/plans/:id
 */
export const deletePlan = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ detail: 'Plan ID is required' });

    const existing = await query(`SELECT * FROM plans WHERE id = ? LIMIT 1`, [id]);
    if (!existing || existing.length === 0) {
      return res.status(404).json({ detail: 'Plan not found' });
    }

    await query(`DELETE FROM plans WHERE id = ?`, [id]);
    console.log(`🗑️ Admin deleted plan [${id}]`);

    return res.json({
      success: true,
      message: 'Plan deleted successfully'
    });
  } catch (err) {
    console.error('❌ Error deleting plan:', err);
    next(err);
  }
};
