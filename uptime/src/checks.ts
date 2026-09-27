// Service list + configuration parsing.
//
// The list ships with Mawzun defaults and is fully replaceable at runtime
// through the CHECKS env var (JSON array) — no code edit, no redeploy when
// set as a secret/variable. A check with an empty url renders greyed out as
// "not configured" and is never pinged (that's how the optional Shopify sync
// entry behaves out of the box).

export interface Check {
  id: string;
  name: string;
  url: string;
  /** Substring that must appear in the body (in addition to HTTP 200). */
  contains?: string;
}

export const DEFAULT_CHECKS: Check[] = [
  { id: "site", name: "Website", url: "https://mawzun.org/" },
  { id: "app", name: "Dashboard", url: "https://app.mawzun.org/" },
  { id: "api", name: "API", url: "https://api.mawzun.org/", contains: "Mawzun API is running" },
  { id: "ai", name: "AI API", url: "https://ai.mawzun.org/healthz", contains: "ok" },
  { id: "docs", name: "Docs", url: "https://docs.mawzun.org/" },
  { id: "webhook", name: "Shopify sync", url: "" }, // empty url = not configured
];

// A malformed CHECKS value throws loudly ON PURPOSE: a status page quietly
// monitoring the wrong services is far worse than a visible error.
export function parseChecks(raw: string | undefined): Check[] {
  if (!raw || !raw.trim()) return DEFAULT_CHECKS;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`CHECKS is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("CHECKS must be a non-empty JSON array");
  }
  const seen = new Set<string>();
  return parsed.map((item, i): Check => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`CHECKS[${i}] must be an object`);
    }
    const c = item as Record<string, unknown>;
    if (typeof c.id !== "string" || !c.id.trim()) {
      throw new Error(`CHECKS[${i}].id must be a non-empty string`);
    }
    if (typeof c.name !== "string" || !c.name.trim()) {
      throw new Error(`CHECKS[${i}].name must be a non-empty string`);
    }
    if (typeof c.url !== "string") {
      throw new Error(`CHECKS[${i}].url must be a string ("" = not configured)`);
    }
    const url = c.url.trim();
    if (url && !/^https?:\/\//i.test(url)) {
      throw new Error(`CHECKS[${i}].url must start with http:// or https://`);
    }
    if (c.contains !== undefined && c.contains !== null && typeof c.contains !== "string") {
      throw new Error(`CHECKS[${i}].contains must be a string when present`);
    }
    if (seen.has(c.id)) {
      throw new Error(`CHECKS has a duplicate id "${c.id}"`);
    }
    seen.add(c.id);
    const check: Check = { id: c.id.trim(), name: c.name.trim(), url };
    if (typeof c.contains === "string" && c.contains) check.contains = c.contains;
    return check;
  });
}

export function brand(env: { SITE_NAME?: string; SITE_URL?: string }): { name: string; url: string } {
  return {
    name: (env.SITE_NAME ?? "").trim() || "Mawzun",
    url: (env.SITE_URL ?? "").trim() || "https://mawzun.org",
  };
}
