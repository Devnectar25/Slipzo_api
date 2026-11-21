// GST per product. The shop decides (Shop profile) whether products carry GST at all and whether
// bills show the GST breakdown. A product's selling price is before GST; the bill charges price + GST.
// Keep in step with the app's src/lib/gst.js.

/** "18", 18, "5.5" -> 18 / 5.5 (0-50, two decimals); empty or invalid -> 0 */
export const normalizeGstRate = (value) => {
    if (value === null || value === undefined || value === '') return 0;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.min(50, Math.round(n * 100) / 100);
};

/** true/1/'1'/'true'/'t' -> 1, everything else -> 0 */
export const flag = (value) => (value === true || value === 1 || value === '1' || value === 'true' || value === 't' ? 1 : 0);
