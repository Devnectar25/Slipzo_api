import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'slipzo-secret-key-2024';

export const generateToken = (userId) => {
    console.log('🔑 Generating token for user:', userId);
    return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '7d' });
};

export const verifyToken = (token) => {
    try {
        console.log('🔑 Verifying token...');
        const decoded = jwt.verify(token, JWT_SECRET);
        console.log('✅ Token verified for user:', decoded.userId);
        return decoded;
    } catch (err) {
        console.error('❌ Token verification failed:', err.message);
        return null;
    }
};

export const generateBillNumber = (prefix = 'SLP', sequence = null, format = 'PREFIX-DATE-SEQ') => {
    const cleanPrefix = (prefix || 'SLP').trim().toUpperCase();
    const date = new Date();
    const fullYear = date.getFullYear().toString();
    const shortYear = fullYear.slice(-2);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const dateStr = `${fullYear}${month}${day}`;
    const shortDateStr = `${shortYear}${month}${day}`;

    const seqStr = sequence !== null && sequence !== undefined
        ? String(sequence).padStart(4, '0')
        : String(Math.floor(Math.random() * 10000)).padStart(4, '0');

    if (format === 'PREFIX-SEQ') {
        return `${cleanPrefix}-${seqStr}`;
    } else if (format === 'PREFIX-SHORTDATE-SEQ') {
        return `${cleanPrefix}-${shortDateStr}-${seqStr}`;
    } else if (format === 'SEQ') {
        return `${seqStr}`;
    }
    // Default: 'PREFIX-DATE-SEQ'
    return `${cleanPrefix}-${dateStr}-${seqStr}`;
};

export const calculateBillTotals = (items, discount = 0, taxRate = 0) => {
    const subtotal = items.reduce((sum, item) => {
        return sum + (Number(item.quantity) || 0) * (Number(item.rate) || 0);
    }, 0);
    
    const discountAmount = Number(discount) || 0;
    const taxable = Math.max(0, subtotal - discountAmount);
    const taxAmount = taxable * (Number(taxRate) || 0) / 100;
    const total = taxable + taxAmount;
    
    return { subtotal, tax_amount: taxAmount, total };
};

export const validateEmail = (email) => {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
};

export const sanitizeString = (str) => {
    if (!str) return '';
    return str.trim().replace(/[<>]/g, '');
};