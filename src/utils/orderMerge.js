// Two devices can work on the same restaurant table. What this device changed (mine compared with base, the order it
// started from) is added to the order as it is on the server (theirs), so nothing a second waiter added is lost and
// nothing already billed comes back. Keep in step with Slipzo/src/lib/orderMerge.js.

const keyOf = (it) => String(it?.name || '').trim().toLowerCase();
const qtyOf = (it) => Number(it?.quantity ?? it?.qty ?? 0) || 0;
const round3 = (n) => Math.round(n * 1000) / 1000;

const byKey = (list) => {
    const map = new Map();
    for (const it of Array.isArray(list) ? list : []) {
        const key = keyOf(it);
        if (!key) continue;
        const seen = map.get(key);
        map.set(key, seen ? { ...seen, quantity: round3(qtyOf(seen) + qtyOf(it)) } : { ...it, quantity: qtyOf(it) });
    }
    return map;
};

/** The same items with the same quantities (order and other details do not matter) */
export const sameOrder = (a, b) => {
    const A = byKey(a), B = byKey(b);
    if (A.size !== B.size) return false;
    for (const [key, it] of A) if (!B.has(key) || qtyOf(B.get(key)) !== qtyOf(it)) return false;
    return true;
};

export const mergeOrders = (base, mine, theirs) => {
    const B = byKey(base), M = byKey(mine), T = byKey(theirs);
    const out = [];
    for (const key of new Set([...T.keys(), ...M.keys()])) {
        const quantity = round3(qtyOf(T.get(key)) + qtyOf(M.get(key)) - qtyOf(B.get(key)));
        if (quantity <= 0) continue;
        out.push({ ...(T.get(key) || {}), ...(M.get(key) || {}), quantity, qty: quantity });
    }
    return out;
};