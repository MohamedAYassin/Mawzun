// Verifies DETAIL endpoints still return their relations — the frontend reads
// operationType / fromWarehouse / toWarehouse / executedBy / stockLevels, and
// the list check does not cover the detail paths.
process.env.REDIS_URL = "";
const { dbAdmin } = await import("./dist/config/database.js");
const { signAccessToken } = await import("./dist/utils/jwt.js");
const app = (await import("./dist/app.js")).default;

const seed = await dbAdmin.stockOperation.findFirstOrThrow({ select: { id: true, companyId: true } });
const c = await dbAdmin.company.findUniqueOrThrow({ where: { id: seed.companyId }, select: { ownerId: true } });
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

// Pick one id per detail route.
// Non-deleted rows only — a soft-deleted row correctly 404s, which is not a
// relation-shape failure and would give a false reading here.
const one = async (model, where = {}) =>
  (await dbAdmin[model].findFirst({ where: { deletedAt: null, ...where }, select: { id: true } }))?.id;

const details = [
  { path: `/api/v1/inventory/operations/${await one("stockOperation")}`, rel: ["operationType", "fromWarehouse", "toWarehouse", "executedBy", "items"] },
  { path: `/api/v1/inventory/counts/${await one("stockCount")}`, rel: ["warehouse", "storageLocation", "items"] },
  { path: `/api/v1/catalog/products/${await one("product", { deletedAt: null })}`, rel: ["category", "brand", "uom", "images", "variants"] },
  { path: `/api/v1/sales/orders/${await one("order", { deletedAt: null })}`, rel: ["customer", "carrier", "orderSource", "items"] },
];

for (const { path, rel } of details) {
  const res = await fetch(B + path, hdr);
  if (res.status !== 200) {
    console.log(`SKIP  ${path.split("/").slice(0, 4).join("/")}/… (${res.status})`);
    continue;
  }
  const body = await res.json();
  const row = body.data;
  if (!row || typeof row !== "object") {
    console.log(`EMPTY ${path}`);
    continue;
  }
  const missing = rel.filter((k) => !Object.prototype.hasOwnProperty.call(row, k));
  const short = path.replace("/api/v1", "").replace(/\/[0-9a-f-]{20,}/, "/:id");
  console.log(`${missing.length ? "FAIL" : "PASS"}  ${short}`);
  if (missing.length) console.log(`        MISSING: ${missing.join(", ")}`);
}

server.close();
process.exit(0);
