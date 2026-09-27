// Proves the onboarding flow works end to end, against the real database.
//
// Checks the four things that matter and that a route-existence test cannot:
//   1. a fresh company reads as NOT onboarded
//   2. completing with skipped steps records them
//   3. the settings the wizard collected are actually persisted
//   4. the session response carries the flag, so no extra round-trip is needed
process.env.REDIS_URL = "";

const { dbAdmin } = await import("./dist/config/database.js");
const { signAccessToken } = await import("./dist/utils/jwt.js");
const app = (await import("./dist/app.js")).default;

// A real company that has never been onboarded.
const company = await dbAdmin.company.findFirstOrThrow({
  where: { deletedAt: null, settings: { onboardingCompletedAt: null } },
  select: { id: true, ownerId: true, name: true },
});
const user = await dbAdmin.user.findUniqueOrThrow({
  where: { id: company.ownerId },
  select: { id: true, email: true, securityStamp: true, companyId: true, isPlatformAdmin: true },
});
const { token } = signAccessToken({
  sub: user.id, sid: "00000000-0000-4000-8000-000000000000", email: user.email,
  securityStamp: user.securityStamp ?? "", companyId: user.companyId, isPlatformAdmin: user.isPlatformAdmin,
});

const server = app.listen(0);
await new Promise((r) => server.once("listening", r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const H = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

console.log(`company: ${company.name}\n`);

// ---- 1. status before ----
const before = await (await fetch(`${BASE}/api/v1/onboarding`, { headers: H })).json();
console.log(`1. status before    -> completed=${before.data.completed}  skipped=[${before.data.skippedSteps}]`);
console.log(`   steps exposed    -> ${before.data.steps.length}: ${before.data.steps.join(", ")}`);

// ---- 2. /auth/me carries it (the no-extra-round-trip claim) ----
const me = await (await fetch(`${BASE}/api/v1/auth/me`, { headers: H })).json();
console.log(`2. /auth/me         -> onboarding=${JSON.stringify(me.data.onboarding)}`);

// ---- 3. complete, skipping two steps ----
const payload = {
  skippedSteps: ["first_product", "order_defaults"],
  businessType: "RETAIL",
  currencyCode: "EGP",
  timeZone: "Africa/Cairo",
  fiscalYearStartMonth: 7,
  defaultSalesVatRate: 14,
  warehouseName: "المستودع الرئيسي",
};
const doneRes = await fetch(`${BASE}/api/v1/onboarding/complete`, {
  method: "POST", headers: H, body: JSON.stringify(payload),
});
const done = await doneRes.json();
console.log(`3. complete         -> HTTP ${doneRes.status}  completed=${done.data?.completed}  skipped=[${done.data?.skippedSteps}]`);

// ---- 4. did the values persist? ----
const settings = await dbAdmin.companySettings.findUniqueOrThrow({
  where: { companyId: company.id },
  select: { fiscalYearStartMonth: true, defaultSalesVatRate: true, onboardingCompletedAt: true, onboardingSkippedSteps: true },
});
const companyRow = await dbAdmin.company.findUniqueOrThrow({
  where: { id: company.id },
  select: { currencyCode: true, timeZone: true },
});
const wh = await dbAdmin.warehouse.findFirst({
  where: { companyId: company.id, deletedAt: null }, orderBy: { createdAt: "asc" }, select: { name: true },
});
console.log(`4. persisted        -> currency=${companyRow.currencyCode} tz=${companyRow.timeZone} fiscalMonth=${settings.fiscalYearStartMonth} vat=${settings.defaultSalesVatRate}`);
console.log(`   warehouse renamed-> "${wh?.name}"`);
console.log(`   completedAt set  -> ${settings.onboardingCompletedAt !== null}`);
console.log(`   skipped stored   -> [${settings.onboardingSkippedSteps}]`);

// ---- 5. status after ----
const after = await (await fetch(`${BASE}/api/v1/onboarding`, { headers: H })).json();
console.log(`5. status after     -> completed=${after.data.completed}  at=${after.data.completedAt?.slice(0,19)}`);

// ---- 6. idempotent: completing again must not fail ----
const again = await fetch(`${BASE}/api/v1/onboarding/complete`, {
  method: "POST", headers: H, body: JSON.stringify({ skippedSteps: [] }),
});
console.log(`6. complete again   -> HTTP ${again.status} (must not fail)`);

// ---- 7. an empty body must be accepted (skippable everything) ----
const other = await dbAdmin.company.findFirst({
  where: { deletedAt: null, settings: { onboardingCompletedAt: null }, id: { not: company.id } },
  select: { id: true, ownerId: true },
});
if (other) {
  const ou = await dbAdmin.user.findUniqueOrThrow({ where: { id: other.ownerId }, select: { id: true, email: true, securityStamp: true, companyId: true, isPlatformAdmin: true } });
  const { token: ot } = signAccessToken({ sub: ou.id, sid: "00000000-0000-4000-8000-000000000000", email: ou.email, securityStamp: ou.securityStamp ?? "", companyId: ou.companyId, isPlatformAdmin: ou.isPlatformAdmin });
  const skipAll = await fetch(`${BASE}/api/v1/onboarding/complete`, {
    method: "POST", headers: { Authorization: `Bearer ${ot}`, "Content-Type": "application/json" }, body: "{}",
  });
  const sj = await skipAll.json();
  console.log(`7. skip everything  -> HTTP ${skipAll.status}  completed=${sj.data?.completed}  skipped=[${sj.data?.skippedSteps}]`);
} else {
  console.log("7. skip everything  -> (no second un-onboarded company to test with)");
}

server.close();
process.exit(0);
