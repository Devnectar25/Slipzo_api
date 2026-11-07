// Confirms with Razorpay that a payment really happened and was for enough money.
// The browser only tells us "a payment id"; anyone can send any id, so it is never trusted on its own.
const apiBase = () => (process.env.RAZORPAY_API_BASE || 'https://api.razorpay.com/v1').replace(/\/$/, '');

export const paymentsConfigured = () => Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);

// Development escape hatch only; it can never be switched on in production
export const unverifiedPaymentsAllowed = () =>
    process.env.ALLOW_UNVERIFIED_PAYMENTS === 'true' && process.env.NODE_ENV !== 'production';

export const verifyPayment = async (paymentId, expectedRupees) => {
    if (!paymentsConfigured()) {
        return { ok: false, code: 'NOT_CONFIGURED', detail: 'Payment verification is not configured on the server.' };
    }
    if (!/^pay_[A-Za-z0-9]+$/.test(String(paymentId || ''))) {
        return { ok: false, code: 'BAD_PAYMENT_ID', detail: 'Invalid payment id.' };
    }
    let res;
    try {
        const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');
        res = await fetch(`${apiBase()}/payments/${paymentId}`, {
            headers: { Authorization: `Basic ${auth}` },
            signal: AbortSignal.timeout(10000)
        });
    } catch (e) {
        return { ok: false, code: 'GATEWAY_UNREACHABLE', detail: 'Could not reach the payment gateway to confirm the payment. Please try again.' };
    }
    if (!res.ok) return { ok: false, code: 'NOT_FOUND', detail: 'This payment could not be found.' };
    const payment = await res.json().catch(() => null);
    if (!payment || (payment.status !== 'captured' && payment.status !== 'authorized')) {
        return { ok: false, code: 'NOT_PAID', detail: 'This payment was not completed.' };
    }
    if (String(payment.currency || 'INR').toUpperCase() !== 'INR') {
        return { ok: false, code: 'BAD_CURRENCY', detail: 'Unexpected payment currency.' };
    }
    if (Number(payment.amount) < Math.round(expectedRupees * 100)) {
        return { ok: false, code: 'AMOUNT_TOO_LOW', detail: 'The amount paid does not cover this pack.' };
    }
    return { ok: true, amountPaise: Number(payment.amount) };
};
