// Resolve the live Postgres URL from Heroku's own Platform API at startup.
//
// No preset DATABASE_URL and no calls to sibling services: the worker asks
// Heroku directly for the app's config vars and reads DATABASE_URL out of
// them. After `heroku pg:credentials:rotate`, the next cache expiry (or the
// next authentication failure) picks up the fresh URL — no redeploy.
//
// Env bindings:
//   HEROKU_API_TOKEN  — long-lived token, created once with:
//                         heroku authorizations:create -d "mawzun-workers-db-url"
//                       (secret; for local dev the output of `heroku auth:token` works)
//   HEROKU_APP_NAME   — e.g. "mawzun" (plain var)
//   DB_URL_TTL_MS     — cache TTL, default 5 min
//
// Cache: the URL string is kept for DB_URL_TTL_MS and re-fetched immediately
// after any postgres authentication failure, so rotation heals on the next
// request instead of the next deploy.

const DEFAULT_TTL_MS = 5 * 60 * 1000;

// Paste artifacts from dashboards/terminals (surrounding quotes, wrapped lines,
// trailing newlines) are the #1 cause of "invalid credentials" against the
// Heroku API. A Bearer token never contains whitespace or quotes anywhere,
// so strip them wholesale rather than just at the edges.
export function cleanToken(raw: string): string {
  return (raw ?? "").replace(/["']/g, "").replace(/\s+/g, "");
}

export interface DbUrlResolver {
  /** Current URL — cached; fetches on first call and after TTL. */
  get(): Promise<string>;
  /** Force a re-fetch (call after a postgres authentication failure). */
  invalidate(): void;
}

interface ResolverEnv {
  HEROKU_API_TOKEN: string;
  HEROKU_APP_NAME: string;
  DB_URL_TTL_MS?: string;
}

export function makeDbUrlResolver(env: ResolverEnv): DbUrlResolver {
  let cached: string | null = null;
  let fetchedAt = 0;
  let inflight: Promise<string> | null = null;

  async function fetchUrl(): Promise<string> {
    const res = await fetch(
      `https://api.heroku.com/apps/${encodeURIComponent(env.HEROKU_APP_NAME)}/config-vars`,
      {
        headers: {
          Accept: "application/vnd.heroku+json; version=3",
          Authorization: `Bearer ${cleanToken(env.HEROKU_API_TOKEN)}`,
        },
        // Never cache the credential at the edge.
        cf: { cacheTtl: 0, cacheEverything: false },
      } as RequestInit
    );
    if (!res.ok) {
      throw new Error(`heroku config-vars ${res.status}`);
    }
    const body = (await res.json()) as { DATABASE_URL?: string };
    const url = body?.DATABASE_URL;
    if (!url) throw new Error("heroku config-vars: no DATABASE_URL");
    return url;
  }

  async function get(): Promise<string> {
    const ttl = Number(env.DB_URL_TTL_MS ?? DEFAULT_TTL_MS);
    if (cached && Date.now() - fetchedAt < ttl) return cached;
    if (!inflight) {
      inflight = fetchUrl()
        .then((url) => {
          cached = url;
          fetchedAt = Date.now();
          return url;
        })
        .finally(() => {
          inflight = null;
        });
    }
    return inflight;
  }

  return {
    get,
    invalidate() {
      cached = null;
      fetchedAt = 0;
    },
  };
}
