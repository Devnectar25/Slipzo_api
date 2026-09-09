import Shop from '../models/Shop.js';

export const getShop = async (req, res, next) => {
  try {
    const shop = await Shop.findByUserId(req.user.id);

    if (!shop) {
      return res.status(404).json({
        detail: 'Shop not found'
      });
    }

    res.json(shop);
  } catch (err) {
    next(err);
  }
};

export const updateShop = async (req, res, next) => {
  try {
    const { name, address, phone, invoice_prefix, invoice_sequence, invoice_format } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        detail: 'Shop name is required'
      });
    }

    const updates = {
      name: name.trim(),
      address: address?.trim() || '',
      phone: phone?.trim() || ''
    };

    if (invoice_prefix !== undefined) {
      updates.invoice_prefix = String(invoice_prefix).trim().toUpperCase() || 'SLP';
    }
    if (invoice_sequence !== undefined) {
      updates.invoice_sequence = Math.max(1, Number(invoice_sequence) || 1001);
    }
    if (invoice_format !== undefined) {
      updates.invoice_format = String(invoice_format).trim() || 'PREFIX-DATE-SEQ';
    }

    const shop = await Shop.update(req.user.id, updates);

    if (!shop) {
      return res.status(404).json({
        detail: 'Shop not found'
      });
    }

    res.json(shop);
  } catch (err) {
    next(err);
  }
};