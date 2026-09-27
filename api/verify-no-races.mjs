// Counts pg concurrency warnings per endpoint, so the remaining multi-relation
// selects are judged by evidence instead of by reading the code.
//
// The warning text is:
//   DeprecationWarning: Calling client.query() when the client is already
//   executing a query
// It is emitted by pg when two statements are in flight on one connection.
process.env.REDIS_URL = "";

const warnings = [];
const origEmit = process.emitWarning;
process.emitWarning = function (...args) {
  const text = typeof args[0] === "string" ? args[0] : (args[0]?.message ?? "");
  if (/already executing a query/i.test(text)) warnings.push(text);
  return origEmit.apply(this, args);
};

const { dbAdmin } = await import("./dist/config/database.js");
const { signAccessToken } = await import("./dist/utils/jwt.js");
const app = (await import("./dist/app.js")).default;

// A company with data.
const c = await dbAdmin.company.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true, ownerId: true } });
const u = await dbAdmin.user.findUniqueOrThrow({
  where: { id: c.ownerId },
  select: { id: true, email: true, securityStamp: true, companyId: true, isPlatformAdmin: true },
});
const { token } = signAccessToken({
  sub: u.id, sid: "00000000-0000-4000-8000-000000000000", email: u.email,
  securityStamp: u.securityStamp ?? "", companyId: u.companyId, isPlatformAdmin: u.isPlatformAdmin,
});

const server = app.listen(0);
await new Promise((r) => server.once("listening", r));
const B = `http://127.0.0.1:${server.address().port}`;
const H = { headers: { Authorization: `Bearer ${token}` } };

const batch = await dbAdmin.productionBatch.findFirst({ where: { deletedAt: null }, select: { id: true } });
const product = await dbAdmin.product.findFirst({ where: { deletedAt: null }, select: { id: true } });

const targets = [
  ["sessions LIST", "/api/v1/system/sessions"],
  ["production batches LIST", "/api/v1/production/batches"],
  ["production batch DETAIL", batch ? `/api/v1/production/batches/${batch.id}` : null],
  ["product DETAIL", product ? `/api/v1/catalog/products/${product.id}` : null],
  ["products LIST", "/api/v1/catalog/products"],
];

// Warm up (pool creation, first query plans) so setup is not counted.
await fetch(`${B}/api/v1/catalog/products`, H);

for (const [label, path] of targets) {
  if (!path) {
    console.log(`SKIP  ${label} (no row)`);
    continue;
  }
  warnings.length = 0;
  // Three requests: a race may not fire on the first.
  for (let i = 0; i < 3; i++) {
    await fetch(B + path, H);
  }
  await new Promise((r) => setTimeout(r, 250));
  const status = warnings.length === 0 ? "CLEAN" : `RACE x${warnings.length}`;
  console.log(`${status.padEnd(10)} ${label}`);
}

server.close();
process.exit(0);
