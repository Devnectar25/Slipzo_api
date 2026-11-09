// Indian mobile numbers are the account ID. They are stored as the plain 10 digits.
// Older email accounts keep working; an account made with a mobile number gets an internal address on a reserved
// ".invalid" domain so everything that is keyed on an email (worker invites, purchase records) keeps working.
const PHONE_EMAIL_DOMAIN = '@phone.slipzo.invalid';

/** "+91 98765-43210", "09876543210", "9876543210" -> "9876543210"; anything else -> null */
export const normalizePhone = (input) => {
    let digits = String(input ?? '').replace(/[\s\-().]/g, '');
    if (digits.startsWith('+')) digits = digits.slice(1);
    if (!/^\d+$/.test(digits)) return null;
    if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
    else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
    return /^[6-9]\d{9}$/.test(digits) ? digits : null;
};

export const phoneToEmail = (phone) => `${phone}${PHONE_EMAIL_DOMAIN}`;

export const isPhoneEmail = (email) => String(email || '').toLowerCase().endsWith(PHONE_EMAIL_DOMAIN);

/** The mobile number behind an internal address, or null for a real email */
export const phoneFromEmail = (email) => (isPhoneEmail(email) ? String(email).split('@')[0] : null);
