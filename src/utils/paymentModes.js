// Payment modes a shop can accept. The shop picks which ones show on its bills (Shop profile).
// Keep this list in step with the app's src/lib/paymentModes.js.
export const PAYMENT_MODES = ['Cash', 'UPI', 'Card', 'Credit'];

const canonical = (value) => PAYMENT_MODES.find((m) => m.toLowerCase() === String(value || '').trim().toLowerCase()) || null;

/** ["upi", "Cash"] or "Cash,UPI" -> ["Cash", "UPI"] (known modes only, in the standard order). Empty -> all modes. */
export const parsePaymentModes = (value) => {
    let list = value;
    if (typeof list === 'string') {
        const raw = list.trim();
        if (raw.startsWith('[')) {
            try { list = JSON.parse(raw); } catch (_) { list = raw.split(','); }
        } else {
            list = raw.split(',');
        }
    }
    if (!Array.isArray(list)) return [...PAYMENT_MODES];
    const picked = new Set(list.map(canonical).filter(Boolean));
    const ordered = PAYMENT_MODES.filter((m) => picked.has(m));
    return ordered.length ? ordered : [...PAYMENT_MODES];
};

/** the default mode, always one of the shop's modes */
export const pickDefaultPaymentMode = (value, modes) => {
    const m = canonical(value);
    return m && modes.includes(m) ? m : modes[0];
};

// ---------- UPI ID (VPA) for the shop's payment QR code ----------
// name@bank: 2-256 letters, digits, dot, dash or underscore, then @ and the bank handle
const UPI_RE = /^[a-z0-9._-]{2,256}@[a-z][a-z0-9.-]{1,63}$/;

/** " Shop@OKAXIS " -> "shop@okaxis"; empty stays "" */
export const normalizeUpiId = (value) => String(value ?? '').trim().toLowerCase();

export const isValidUpiId = (value) => UPI_RE.test(normalizeUpiId(value));

const badRequest = (message) => Object.assign(new Error(message), { statusCode: 400 });

/**
 * Payment settings from a request body (sign up or shop profile), merged with the shop's current ones.
 * Returns only the columns to save. A UPI ID that is filled in must be valid; with requireUpiId,
 * choosing UPI without a UPI ID is refused (sign up), otherwise it is allowed (the bill then asks for it).
 */
export const paymentFieldsFromBody = (body = {}, current = null, { requireUpiId = false } = {}) => {
    const touched = body.payment_modes !== undefined || body.default_payment_mode !== undefined || body.upi_id !== undefined;
    if (!touched) return {};
    const modes = body.payment_modes !== undefined ? parsePaymentModes(body.payment_modes) : (current?.payment_modes || [...PAYMENT_MODES]);
    const fields = {
        payment_modes: modes.join(','),
        default_payment_mode: pickDefaultPaymentMode(
            body.default_payment_mode !== undefined ? body.default_payment_mode : current?.default_payment_mode,
            modes
        )
    };
    if (body.upi_id !== undefined) {
        const upi = normalizeUpiId(body.upi_id);
        if (upi && !isValidUpiId(upi)) throw badRequest('Please enter a valid UPI ID, for example yourname@okaxis');
        fields.upi_id = upi;
    }
    const upiAfter = fields.upi_id !== undefined ? fields.upi_id : (current?.upi_id || '');
    if (requireUpiId && modes.includes('UPI') && !upiAfter) {
        throw badRequest('Enter your UPI ID to take UPI payments, or turn UPI off');
    }
    return fields;
};
