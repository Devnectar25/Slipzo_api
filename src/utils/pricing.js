// Server-side copy of the print pack prices shown on the Pricing page.
// The server decides what a pack costs so a client can never claim more prints than it paid for.
export const MIN_PRINTS = 100;
export const MAX_PRINTS = 50000;

export const rateForPrints = (count) => {
    if (count >= 7500) return 0.18;
    if (count >= 3500) return 0.20;
    if (count >= 1500) return 0.225;
    return 0.25;
};

// Returns the price in whole rupees, or null if the pack size is not one we sell
export const priceForPrints = (prints) => {
    const count = Number(prints);
    if (!Number.isInteger(count) || count < MIN_PRINTS || count > MAX_PRINTS) return null;
    return Math.round(count * rateForPrints(count));
};
