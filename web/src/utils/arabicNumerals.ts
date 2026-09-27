// Convert Latin (Western) digits ↔ Arabic-Indic digits.
// Only DIGITS are mapped; separators (, .), symbols (%), units (K) and
// currency strings pass through untouched, matching the existing Arabic pages.

const ARABIC = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩']
const LATIN = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']

const toArMap: Record<string, string> = Object.fromEntries(
  LATIN.map((d, i) => [d, ARABIC[i]]),
)

/** Render any number/string using Arabic-Indic digits, e.g. 1500.00 → ١,٥٠٠.٠٠ */
export const toArabicNumerals = (v: string | number): string =>
  String(v).replace(/[0-9]+/g, (m) => {
    // skip phone numbers (starting with 0, length > 5)
    if (m[0] === '0' && m.length > 5) return m.replace(/[0-9]/g, (d) => toArMap[d])
    return m.replace(/\B(?=(\d{3})+(?!\d))/g, ',').replace(/[0-9]/g, (d) => toArMap[d])
  })
