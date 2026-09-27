const ARABIC_DIACRITICS = /[ؐ-ًٰۖ-ۭ]/g;

/**
 * URL-safe slug from a company name, keeping Arabic characters intact since
 * company names here are usually Arabic.
 */
export function slugify(input: string): string {
  return input
    .normalize("NFKC")
    .replace(ARABIC_DIACRITICS, "")
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^\p{L}\p{N}-]/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);
}

/** Fallback when a name contains no usable characters at all. */
export function slugifyOrFallback(input: string, fallback = "company"): string {
  const slug = slugify(input);
  return slug.length >= 2 ? slug : fallback;
}
