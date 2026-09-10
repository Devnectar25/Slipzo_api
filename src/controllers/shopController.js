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
    const { name, address, phone, gstin, show_tax, tax_rate, invoice_prefix, invoice_sequence, invoice_format } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ detail: 'Shop name is required' });
    }

    if (name.trim().length < 2 || name.trim().length > 100) {
      return res.status(400).json({ detail: 'Shop name must be between 2 and 100 characters' });
    }

    if (phone && phone.trim()) {
      const digitsOnly = phone.trim().replace(/[^0-9]/g, '');
      if (digitsOnly.length < 7 || digitsOnly.length > 15) {
        return res.status(400).json({ detail: 'Please enter a valid phone number (7-15 digits)' });
      }
    }

    if (address && address.trim().length > 300) {
      return res.status(400).json({ detail: 'Address cannot exceed 300 characters' });
    }

    const updates = {
      name: name.trim(),
      address: address?.trim() || '',
      phone: phone?.trim() || '',
      gstin: gstin ? String(gstin).trim().toUpperCase() : '',
      show_tax: show_tax !== undefined ? Number(show_tax) : 1,
      tax_rate: tax_rate !== undefined ? Number(tax_rate) : 18.00
    };

    if (invoice_prefix !== undefined) {
      const cleanPrefix = String(invoice_prefix).trim().toUpperCase();
      if (invoice_format !== 'SEQ' && cleanPrefix && !/^[A-Za-z0-9]{1,8}$/.test(cleanPrefix)) {
        return res.status(400).json({ detail: 'Invoice prefix must be 1-8 alphanumeric characters' });
      }
      updates.invoice_prefix = cleanPrefix || 'SLP';
    }

    if (invoice_sequence !== undefined) {
      const seqNum = Number(invoice_sequence);
      if (isNaN(seqNum) || seqNum < 1) {
        return res.status(400).json({ detail: 'Sequence number must be at least 1' });
      }
      updates.invoice_sequence = Math.floor(seqNum);
    }

    if (invoice_format !== undefined) {
      updates.invoice_format = String(invoice_format).trim() || 'PREFIX-DATE-SEQ';
    }

    const shop = await Shop.update(req.user.id, updates);

    if (!shop) {
      return res.status(404).json({ detail: 'Shop not found' });
    }

    res.json(shop);
  } catch (err) {
    next(err);
  }
};