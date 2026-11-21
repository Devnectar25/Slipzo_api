// Measuring units for loose items (sold by weight, volume or length).
// An item with no unit is counted in pieces. Keep this list in step with the app's src/lib/units.js.
export const LOOSE_UNITS = ['kg', 'g', 'l', 'ml', 'm', 'dozen'];

const LABELS = { kg: 'kg', g: 'g', l: 'L', ml: 'ml', m: 'm', dozen: 'dozen' };

const ALIASES = {
    kgs: 'kg', kilo: 'kg', kilogram: 'kg', kilograms: 'kg',
    gm: 'g', gms: 'g', gram: 'g', grams: 'g',
    ltr: 'l', litre: 'l', liter: 'l', litres: 'l', liters: 'l',
    millilitre: 'ml', milliliter: 'ml',
    meter: 'm', metre: 'm', meters: 'm', metres: 'm', mtr: 'm',
    dz: 'dozen', doz: 'dozen'
};

/** 'KG', 'Litre', ' kg ' -> 'kg' / 'l'; anything else (pieces, empty, unknown) -> null */
export const normalizeUnit = (value) => {
    if (value === null || value === undefined) return null;
    const v = String(value).trim().toLowerCase();
    if (!v) return null;
    if (LOOSE_UNITS.includes(v)) return v;
    return ALIASES[v] || null;
};

export const unitLabel = (unit) => LABELS[normalizeUnit(unit)] || '';

/** Quantities are kept to 3 decimals (250 g = 0.25 kg, 125 ml = 0.125 L) */
export const roundQty = (n) => Math.round(Number(n) * 1000) / 1000;

/** "2.5 kg" for a loose item, "2" for pieces */
export const qtyText = (n, unit) => {
    const v = roundQty(n);
    const label = unitLabel(unit);
    return label ? `${v} ${label}` : String(v);
};
