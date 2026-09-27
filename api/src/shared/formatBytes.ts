// Byte sizes rendered for an Arabic UI.
//
// The upload limit is configurable (UPLOAD_MAX_BYTES), so every message that
// names it must be DERIVED from the value rather than hardcoded — a literal
// "١٠ ميجابايت" keeps telling users 10 MB after a deployment is reconfigured,
// and the reader then has no way to tell why their file was refused.
//
// Lives in shared/ because both the multer error translation (shared/http.ts)
// and the raw-bytes check in storage (shared/storage.ts) report the same limit,
// and http.ts must not depend on the R2 client to format a number.

/** ASCII digits → Arabic-Indic (٠١٢٣٤٥٦٧٨٩). */
export function toArabicDigits(value: string | number): string {
  return String(value).replace(/[0-9]/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]);
}

/**
 * e.g. 10485760 → "١٠ ميجابايت", 1572864 → "١.٥ ميجابايت".
 *
 * Whole megabytes drop the decimal because "١٠.٠" reads as a mistake; a
 * fractional limit keeps one place so the message is still truthful.
 */
export function formatMegabytesAr(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  const value = Number.isInteger(mb) ? String(mb) : mb.toFixed(1);
  return `${toArabicDigits(value)} ميجابايت`;
}
