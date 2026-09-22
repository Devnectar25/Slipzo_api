import Shop from '../models/Shop.js';
import { supabase } from '../config/database.js';

const BUCKET_NAME = 'Shop_Profile';

/**
 * Uploads a shop profile image to Supabase Storage bucket named 'Shop_Profile'
 * named after that particular shop and user.
 */
async function uploadShopProfileImage(rawData, shopName, userId) {
  try {
    let mimeType = 'image/png';
    let ext = 'png';
    let base64Data = rawData;

    if (rawData.startsWith('data:')) {
      const match = rawData.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.*)$/);
      if (match) {
        mimeType = match[1];
        base64Data = match[2];
        if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') ext = 'jpg';
        else if (mimeType === 'image/webp') ext = 'webp';
        else if (mimeType === 'image/svg+xml') ext = 'svg';
        else if (mimeType === 'image/gif') ext = 'gif';
      }
    }

    const buffer = Buffer.from(base64Data, 'base64');
    const cleanName = (shopName || 'shop')
      .trim()
      .replace(/[^a-zA-Z0-9_\-]/g, '_')
      .replace(/_+/g, '_')
      .toLowerCase();

    const fileName = `${cleanName}_${userId}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(fileName, buffer, {
        contentType: mimeType,
        upsert: true,
      });

    if (uploadError) {
      console.error('❌ Supabase storage upload error:', uploadError.message);
      throw new Error(`Failed to upload to storage: ${uploadError.message}`);
    }

    const { data: urlData } = supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(fileName);

    return `${urlData.publicUrl}?t=${Date.now()}`;
  } catch (err) {
    console.error('❌ Error uploading shop profile image to bucket:', err);
    throw err;
  }
}

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
      const isValid10Digit = digitsOnly.length === 10 || (digitsOnly.length === 12 && digitsOnly.startsWith('91'));
      if (!isValid10Digit) {
        return res.status(400).json({ detail: 'Please enter a valid 10-digit mobile number' });
      }
    }

    if (address && address.trim().length > 300) {
      return res.status(400).json({ detail: 'Address cannot exceed 300 characters' });
    }

    const updates = {
      name: name.trim(),
      address: address?.trim() || '',
      phone: phone?.trim() || ''
    };

    if (gstin !== undefined) {
      updates.gstin = gstin ? String(gstin).trim().toUpperCase() : '';
    }

    if (show_tax !== undefined) {
      updates.show_tax = Number(show_tax);
    }

    if (tax_rate !== undefined) {
      updates.tax_rate = Number(tax_rate);
    }

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

    if (req.body.default_template_id !== undefined) {
      updates.default_template_id = String(req.body.default_template_id).trim();
    }

    if (req.body.default_discount !== undefined) {
      const disc = parseFloat(req.body.default_discount);
      updates.default_discount = isNaN(disc) || disc < 0 ? 0 : disc;
    }

    if (req.body.logo_url !== undefined) {
      const logoInput = req.body.logo_url ? String(req.body.logo_url).trim() : '';
      if (!logoInput) {
        updates.logo_url = '';
      } else if (logoInput.startsWith('data:image/') || (logoInput.length > 500 && !logoInput.startsWith('http'))) {
        // Raw/base64 image uploaded: store in Supabase Storage bucket named on that particular shop & user
        const targetShopName = name?.trim() || req.user.name || req.user.username || 'shop';
        updates.logo_url = await uploadShopProfileImage(logoInput, targetShopName, req.user.id);
      } else {
        // Clean URL pointing to bucket
        updates.logo_url = logoInput;
      }
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

export const uploadShopLogo = async (req, res, next) => {
  try {
    const { image, name } = req.body;
    if (!image) {
      return res.status(400).json({ detail: 'Image data is required' });
    }
    const targetShopName = name?.trim() || req.user.name || req.user.username || 'shop';
    const publicUrl = await uploadShopProfileImage(image, targetShopName, req.user.id);

    await Shop.update(req.user.id, { logo_url: publicUrl });

    res.json({ logo_url: publicUrl });
  } catch (err) {
    next(err);
  }
};