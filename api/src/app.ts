import cors from "cors";
import express from "express";
import { randomUUID } from "node:crypto";
import { authLimitKey, rateLimiter } from "./lib/rateLimit.js";
import { env } from "./config/env.js";
import { errorHandler, notFoundHandler, ok } from "./shared/http.js";
import { createApiRouter } from "./routes/index.js";
import { db } from "./config/database.js";
import { observeHttp, startMetricsPush, registry } from "./observability/metrics.js";

// ---------------------------------------------------------------------------
// Application wiring
// ---------------------------------------------------------------------------
//
// Everything below is transport: parsers, headers, static files and the single
// mount point for the API. No business rules live here, and no route is
// registered outside `createApiRouter`.

const app = express();

// Behind Heroku + Cloudflare the visitor IP arrives in X-Forwarded-For as
// "<client>, <cf-edge>" with the Heroku router appending itself. Trusting one
// hop yields the Cloudflare edge IP (every visitor shares one bucket), so
// trust both hops to reach the real client. Without this, req.ip is a Heroku
// router internal address (visible in logs as ::ffff:10.x keys).
app.set("trust proxy", 2);

// ---------- CORS ----------

app.use(
  cors({
    origin: (origin, callback) => {
      // Requests with no Origin header — curl, mobile clients, same-origin
      // server-to-server calls — are allowed through.
      if (!origin) return callback(null, true);

      if (isAllowedOrigin(origin)) return callback(null, true);

      callback(new Error("The CORS policy for this site does not allow the specified origin."), false);
    },
    credentials: true,
  })
);

/**
 * Which origins may call the API.
 *
 * The list is driven by CORS_ORIGIN so a deployment does not need a code
 * change, with the local Vite range kept for development: Vite picks a free
 * port, so the allowed set cannot be a single hard-coded value.
 */
function isAllowedOrigin(origin: string): boolean {
  const configured = env.CORS_ORIGIN.split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (configured.includes("*")) return true;
  if (configured.includes(origin)) return true;

  if (env.NODE_ENV !== "production") {
    // Vite dev server and its fallbacks.
    if (/^http:\/\/localhost:\d+$/.test(origin)) return true;
    if (/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) return true;
  }

  return false;
}

// ---------- Security headers ----------

app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "img-src 'self' data: https:",
      "font-src 'self' data: https:",
      "style-src 'self' 'unsafe-inline' https:",
      "script-src 'self' 'unsafe-inline'",
      "connect-src 'self' wss: https:",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "upgrade-insecure-requests",
    ].join("; ")
  );

  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=()"
  );

  next();
});

// ---------- Parsers ----------

app.use(express.json({ limit: env.BODY_PARSER_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: env.BODY_PARSER_LIMIT }));


// ---------- Observability ----------

// A request id, so a user's "it failed at 14:02" can be matched to a breadcrumb
// row without guessing. Declared on Express's Request so handlers read it
// without a cast — the error handler previously read `requestId` through
// `as unknown as {...}`, which is what a field with no writer looks like: the
// column existed and was always NULL.
declare module "express-serve-static-core" {
  interface Request {
    requestId?: string;
  }
}

app.use((req, res, next) => {
  // Reuse an upstream id when the proxy supplied one (Cloudflare does), so the
  // same request is correlatable across services instead of getting a second,
  // unrelated id here.
  const supplied = req.headers["x-request-id"];
  const id =
    typeof supplied === "string" && supplied.length > 0 && supplied.length <= 64
      ? supplied
      : randomUUID();

  req.requestId = id;
  // Echoed back so a client or an edge log can quote it in a bug report.
  res.setHeader("X-Request-Id", id);
  next();
});

// Route-template classifier: keeps cardinally bounded labels (no raw URLs —
// ids collapse to :id). Extend the list when new parametrised routes appear.
//
// NOTE: the client IP and User-Agent are deliberately NOT metric labels. Both
// are unbounded — every visitor would mint a new time series — and Prometheus
// charges for that in memory and cardinality, so they belong in the breadcrumb
// trail (error_log), which is a log and can carry them.
const ROUTE_TEMPLATES: [RegExp, string][] = [
  [/^\/api\/v1\/auth\/[^/]+$/, "/api/v1/auth/:action"],
  [/^\/api\/v1\/auth\/[^/]+\/[^/]+$/, "/api/v1/auth/:action/:sub"],
  [/^\/api\/v1\/companies\/[^/]+/, "/api/v1/companies/:id"],
  [/^\/api\/v1\/users\/[^/]+/, "/api/v1/users/:id"],
  [/^\/api\/v1\/orders\/[^/]+/, "/api/v1/orders/:id"],
  [/^\/api\/v1\/stores\/[^/]+/, "/api/v1/stores/:id"],
];

function routeTemplate(url: string): string {
  const path = url.split("?")[0];
  for (const [re, template] of ROUTE_TEMPLATES) {
    if (re.test(path)) return template;
  }
  return path;
}

app.use((req, res, next) => {
  if (req.path === "/api/v1/metrics") return next(); // self-exclusion
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
    observeHttp({ route: routeTemplate(req.path), method: req.method, status: res.statusCode, durationSeconds });
  });
  next();
});

app.get("/api/v1/metrics", async (_req, res) => {
  res.set("Content-Type", registry.contentType);
  res.end(await registry.metrics());
});
// ---------- Static uploads ----------



// ---------- Routes ----------

app.get("/", (_req, res) => {
  ok(res, { name: "Mawzun API", version: 1 }, "Mawzun API is running.");
});

/**
 * Liveness + readiness in one endpoint.
 *
 * `/` above answers "is this process up?" and is what the status page polls, but
 * it returns 200 even when the database is unreachable — the process is fine,
 * it just cannot serve anything. A load balancer pointed at `/` would keep
 * sending traffic to a dyno that can only produce 500s.
 *
 * `/healthz` therefore actually touches the database. It runs one trivial
 * query on the APP pool (the client every request uses), so a broken pool,
 * revoked role or dropped connection surfaces here rather than in a user's
 * request.
 *
 * Deliberately unauthenticated: a health probe has no credentials, and the
 * response carries no data — only whether the dependency answered. It also
 * deliberately does not fail on a missing Redis: the limiters are designed to
 * fail open, so a cache outage must not take the service out of rotation.
 *
 * 200 = ready. 503 = the process is up but cannot serve requests.
 */
app.get("/healthz", async (_req, res) => {
  const startedAt = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    res.status(200).json({
      success: true,
      message: "ok",
      data: { database: "up", uptimeSeconds: Math.round(process.uptime()), latencyMs: Date.now() - startedAt },
    });
  } catch {
    // The error is not echoed: a probe is unauthenticated, and driver errors
    // can include host and role names. The log has the detail.
    res.status(503).json({
      success: false,
      message: "database unavailable",
      data: { database: "down", uptimeSeconds: Math.round(process.uptime()) },
    });
  }
});

// Brute-force protection on the unauthenticated entry points, counted in
// Redis so every dyno shares one window. Keyed per IP+account pair so one
// targeted attack does not lock out an office sharing an IP. A successful
// login/signup clears the key (see auth.service), which replaces the old
// limiter's skipSuccessfulRequests.
const authLimiter = rateLimiter({
  disabled: env.RATE_LIMIT_AUTH_DISABLED,
  max: env.RATE_LIMIT_AUTH_MAX,
  windowMs: env.RATE_LIMIT_AUTH_WINDOW_MS,
  message: "محاولات كثيرة جداً. حاول مرة أخرى بعد ١٥ دقيقة.",
  key: (req) => {
    const body = req.body as { email?: string } | undefined;
    return authLimitKey(req.ip, body?.email);
  },
});
app.use("/api/v1/auth/forgot-password/check", authLimiter);
app.use("/api/v1/auth/forgot-password", authLimiter);
app.use("/api/v1/auth/login", authLimiter);
app.use("/api/v1/auth/signup", authLimiter);
app.use("/api/v1/auth/refresh", authLimiter);

app.use("/api/v1", createApiRouter());

// ---------- Errors ----------

app.use(notFoundHandler);
app.use(errorHandler);

// Metrics remote-write loop (no-op without Grafana env vars).
startMetricsPush();

export default app;
