// Verifies the endpoints I refactored still return their relations.
// This is the check I should have run BEFORE calling the refactor done: the
// compiler cannot see a response shape, and the test suite does not assert on
// relation presence for most of these routes.
process.env.REDIS_URL = "";
const { dbAdmin } = await import("./dist/config/database.js");
const { signAccessToken } = await import("./dist/utils/jwt.js");
const app = (await import("./dist/app.js")).default;

// Owner => every permission.
// The company that actually holds inventory/order data, so the relations have
// something to be present ON.
const seed = await dbAdmin.stockLevel.findFirstOrThrow({ select: { companyId: true } });
const c = await dbAdmin.company.findUniqueOrThrow({ where: { id: seed.companyId }, select: { id: true, ownerId: true } });
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
const hdr = { headers: { Authorization: `Bearer ${token}` } };

const checks = [
  { path: "/api/v1/inventory/stock/levels", rel: ["product", "storageLocation"] },
  { path: "/api/v1/inventory/stock/transactions", rel: ["product", "storageLocation", "actor"] },
  { path: "/api/v1/inventory/counts", rel: ["warehouse", "storageLocation", "items"] },
  { path: "/api/v1/inventory/operations", rel: ["operationType", "fromWarehouse", "toWarehouse", "executedBy", "items"] },
  { path: "/api/v1/catalog/products", rel: ["category", "brand", "uom", "primaryImage", "_count"] },
    { path: "/api/v1/sales/orders", rel: ["customer", "carrier", "orderSource", "paymentMethod", "city", "shippingGovernorate", "warehouse", "_count"] },
];

for (const { path, rel } of checks) {
  const res = await fetch(B + path, hdr);
  if (res.status !== 200) {
    console.log(`SKIP  ${path} (${res.status})`);
    continue;
  }
  const body = await res.json();
  const rows = body.data?.items ?? [];
  if (!Array.isArray(rows) || rows.length === 0) {
    console.log(`EMPTY ${path} — cannot verify relations (0 rows)`);
    continue;
  }
  const present = rel.filter((k) => Object.prototype.hasOwnProperty.call(rows[0], k));
  const missing = rel.filter((k) => !Object.prototype.hasOwnProperty.call(rows[0], k));
  console.log(`${missing.length ? "FAIL" : "PASS"}  ${path}`);
  console.log(`        present: ${present.join(", ") || "none"}`);
  if (missing.length) console.log(`        MISSING: ${missing.join(", ")}`);
}

server.close();
process.exit(0);
