// Verifies that a breadcrumb records the useful context and NEVER a credential.
//
// Runs against the real logs database through the REAL capture path
// (src/observability/errorCapture.ts), so it proves what ships rather than what
// a re-implementation would do. The security half is the point: a redaction bug
// writes a password into a log table, and nothing else in the suite would catch
// that.
//
// Usage: npx tsx verify-redaction.mjs
// Safe to re-run: every row it writes is deleted in a finally block.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import postgres from "postgres";
import { captureError, closeLogsPool } from "./src/observability/errorCapture.ts";
import { bodyForLog, redact, isSensitiveKey, truncate, REDACTED } from "./src/observability/redact.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const env = readFileSync(resolve(HERE, ".env"), "utf8");
const logsUrl = env.match(/^LOG_DATABASE_URL="?([^"\n]+)"?/m)?.[1];
if (!logsUrl) throw new Error("LOG_DATABASE_URL not found in api/.env");

// captureError reads the raw env var, so make sure it is present in-process.
process.env.LOG_DATABASE_URL = logsUrl;
const sql = postgres(logsUrl.replace(/\?schema=\w+$/, ""), { max: 2, prepare: false });

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? `  — ${detail}` : ""}`); }
};

// A marker unique to this run, so assertions cannot match an older row.
const RUN = `redact-${Date.now()}`;

console.log("=== pure redaction rules (no database) ===\n");

// Credential-shaped keys, including the camelCase variants a real body uses.
for (const key of ["password", "currentPassword", "newPassword", "passwd", "passCode", "pass",
                   "pwd", "refreshToken", "accessToken", "apiKey", "keyHash", "accessKeyId",
                   "secretAccessKey", "authorization", "Authorization", "cookie", "secret",
                   "clientSecret", "cardNumber", "cardHolder", "cvc", "iban", "otp", "signature",
                   "pin", "ssn", "accountNumber", "sessionId",
                   "shopifyAccessToken", "shopifyWebhookSecret", "turnstileToken"]) {
  check(`isSensitiveKey(${key})`, isSensitiveKey(key) === true);
}
// Ordinary fields must survive, or the log is useless. Every entry after
// "warehouseId" is an over-redaction trap that a naive pattern swallows:
// /pin/ matches "shipping", /card/ matches "discarded", /ssn/ matches
// "bypassNote" (bypa-SSN-ote), /pass/ matches "passengers", /key/ matches
// "permissionKeys", and /account/ would match nothing here but "keys" is the
// control that must stay a plain field.
for (const key of ["name", "quantity", "email", "status", "orderNumber", "sku", "warehouseId",
                   "shippingAddress", "shippingGovernorateId", "discardedAt", "bypassNote",
                   "passengers", "compass", "permissionKeys", "keyPrefix", "keyed", "keys",
                   "productName", "notes", "className"]) {
  check(`isSensitiveKey(${key}) is false`, isSensitiveKey(key) === false);
}

const redacted = redact({ name: "Widget", password: "hunter2", nested: { token: "abc", qty: 5 } });
check("keeps an ordinary field", redacted.name === "Widget");
check("redacts password", redacted.password === REDACTED);
check("redacts a nested token", redacted.nested.token === REDACTED);
check("keeps a nested ordinary field", redacted.nested.qty === 5);

// Depth and size limits: a hostile or accidental structure must not be able to
// blow up the log or the request.
let deep = { v: 1 };
for (let i = 0; i < 30; i++) deep = { nested: deep };
check("depth-limited rather than infinite", JSON.stringify(redact(deep)).includes("depth limit"));

const bigArray = redact(Array.from({ length: 200 }, (_, i) => i));
check("long array truncated", Array.isArray(bigArray) && bigArray.length === 51);

// truncate must not split a surrogate pair, which would corrupt the value.
const emoji = "a".repeat(9) + "😀" + "b".repeat(5);
const cut = truncate(emoji, 10);
check("truncate does not split a surrogate pair", !/[\uD800-\uDBFF]$/.test(cut.slice(0, -1)));

console.log("\n=== bodies are withheld where they ARE the credentials ===\n");

for (const route of ["/api/v1/auth/login", "/api/v1/auth/signup", "/api/v1/auth/refresh",
                     "/api/v1/auth/reset-password", "/api/v1/auth/change-password"]) {
  check(`body withheld for ${route}`, bodyForLog(route, { password: "x" }) === "[withheld: credentials]");
}
// A non-auth route keeps its (redacted) body, or the feature does nothing.
const kept = bodyForLog("/api/v1/sales/orders", { quantity: -5, password: "nope" });
check("non-auth body is kept", typeof kept === "string" && kept.includes("-5"));
check("non-auth body still redacts the password", !kept.includes("nope"));

console.log("\n=== through the real capture path, into the logs database ===\n");

const created = [];
try {
  // 1. An ordinary API error: body, client, tenant must all be recorded.
  await captureError(new Error(`${RUN} validation failed`), {
    route: "/api/v1/sales/orders",
    method: "POST",
    status: 422,
    requestId: `${RUN}-req`,
    ipAddress: "203.0.113.9",
    userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/151.0.0.0",
    userId: "user-abc-123",
    companyId: "company-xyz-789",
    body: { quantity: -5, name: "Widget", password: "hunter2", refreshToken: "tok_123" },
  });

  // 2. An auth error: the body must be withheld even though it holds a password.
  await captureError(new Error(`${RUN} bad credentials`), {
    route: "/api/v1/auth/login",
    method: "POST",
    status: 401,
    ipAddress: "198.51.100.7",
    body: { email: "someone@example.com", password: "SuperSecret123!" },
  });

  // Give the fire-and-forget writes a moment to land.
  await new Promise((r) => setTimeout(r, 900));

  const rows = await sql`
    SELECT message, route, method, status, "requestId", "ipAddress", "userAgent",
           "userId", "companyId", body
    FROM error_log WHERE message LIKE ${RUN + "%"} ORDER BY "createdAt"`;
  for (const r of rows) created.push(r);

  check("both breadcrumbs were written", rows.length === 2, `got ${rows.length}`);

  const api = rows.find((r) => r.route === "/api/v1/sales/orders");
  const auth = rows.find((r) => r.route === "/api/v1/auth/login");

  check("api: ipAddress recorded", api?.ipAddress === "203.0.113.9", api?.ipAddress);
  check("api: userAgent recorded", (api?.userAgent ?? "").includes("Chrome/151"), api?.userAgent);
  check("api: userId recorded", api?.userId === "user-abc-123", api?.userId);
  check("api: companyId recorded", api?.companyId === "company-xyz-789", api?.companyId);
  check("api: requestId recorded", api?.requestId === `${RUN}-req`, api?.requestId);
  check("api: status recorded", api?.status === 422, String(api?.status));
  check("api: body kept the useful field", (api?.body ?? "").includes("-5"), api?.body);
  check("api: body kept the ordinary field", (api?.body ?? "").includes("Widget"), api?.body);

  // THE security assertions.
  check("api: password NOT in the stored body", !(api?.body ?? "").includes("hunter2"), api?.body);
  check("api: token NOT in the stored body", !(api?.body ?? "").includes("tok_123"), api?.body);
  check("api: body shows the redaction marker", (api?.body ?? "").includes(REDACTED), api?.body);

  check("auth: body withheld entirely", auth?.body === "[withheld: credentials]", auth?.body);
  check("auth: password NOT stored anywhere in the row",
    !JSON.stringify(auth ?? {}).includes("SuperSecret123!"), JSON.stringify(auth));
  check("auth: email NOT stored either (body withheld whole)",
    !JSON.stringify(auth ?? {}).includes("someone@example.com"));

  // The whole table, not just this run: a leak could come from any write path.
  const leak = await sql`
    SELECT count(*)::int AS n FROM error_log
    WHERE body LIKE ${"%hunter2%"} OR body LIKE ${"%SuperSecret123!%"}
       OR message LIKE ${"%hunter2%"} OR "userAgent" LIKE ${"%SuperSecret123!%"}`;
  check("no credential anywhere in the error_log table", leak[0].n === 0, `${leak[0].n} row(s)`);

  // An oversized User-Agent must not lose the breadcrumb: the column is
  // VARCHAR(300) and Postgres rejects an over-length value outright.
  await captureError(new Error(`${RUN} long ua`), {
    route: "/api/v1/catalog/products",
    method: "GET",
    status: 500,
    userAgent: "X".repeat(5000),
  });
  await new Promise((r) => setTimeout(r, 700));
  const longUa = await sql`
    SELECT "userAgent" FROM error_log WHERE message = ${`${RUN} long ua`}`;
  check("over-long User-Agent was truncated, not rejected", longUa.length === 1 && (longUa[0].userAgent ?? "").length <= 300,
    `${longUa.length} row(s), len ${longUa[0]?.userAgent?.length}`);

  // A 5xx must SURVIVE a burst of higher-volume 4xx. Validation failures are
  // captured now and are the highest-volume 4xx, so without the exemption the
  // trail would be all 422s and the server error would be gone — exactly when
  // it is needed. Written as: record a 5xx, flood with 422s, assert the 5xx is
  // still there.
  await captureError(new Error(`${RUN} server error to protect`), {
    route: "/api/v1/catalog/products",
    method: "POST",
    status: 500,
  });
  for (let i = 0; i < 240; i++) {
    await captureError(new Error(`${RUN} flood ${i}`), {
      route: "/api/v1/catalog/products",
      method: "POST",
      status: 422,
    });
  }
  await new Promise((r) => setTimeout(r, 1200));
  const survived = await sql`
    SELECT count(*)::int AS n FROM error_log WHERE message = ${`${RUN} server error to protect`}`;
  check("a 5xx survives a 240-row 4xx flood", survived[0].n === 1, `found ${survived[0].n}`);

  // And the flood itself must not grow the table without bound.
  const total = await sql`SELECT count(*)::int AS n FROM error_log`;
  check("table stays bounded (200 + protected 5xx)", total[0].n < 600, `${total[0].n} rows`);
} finally {
  // Remove every row this run wrote, matched by the unique marker.
  const del = await sql`DELETE FROM error_log WHERE message LIKE ${RUN + "%"} RETURNING id`;
  console.log(`\ncleanup: removed ${del.length} fixture row(s)`);
  await sql.end({ timeout: 1 }).catch(() => {});
  await closeLogsPool();
}

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
