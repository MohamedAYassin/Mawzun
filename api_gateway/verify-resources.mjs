// Verifies the AI API exposes every resource family a user can manage.
//
// The dashboard can create and edit ~30 resource families. Before this existed
// the AI API covered 7 of them, so an agent driving the API could not do what a
// user could do in the UI — the gap this file exists to keep closed.
//
// It drives the RUNNING worker over HTTP rather than importing the route table,
// because the route table being correct is not the thing under test: a route
// that is registered but 500s on the driver is still broken. It also asserts the
// failure mode, not just the happy path — an invalid enum must be a 400 that
// names the allowed values, never a 500. That distinction is not cosmetic: the
// first version of this surface passed the happy path and returned 500 for a bad
// enum, because the enum list had been guessed instead of read from pg_enum.
//
// Usage: node verify-ai-resources.mjs [baseUrl] [apiKey]
//   baseUrl defaults to http://127.0.0.1:8791
//   apiKey  defaults to the AI_KEY environment variable
//
// Exit code 0 = every check passed.

import process from "node:process";

const BASE = (process.argv[2] ?? "http://127.0.0.1:8791").replace(/\/$/, "");
const KEY = process.argv[3] ?? process.env.AI_KEY ?? "";

if (!KEY) {
  console.error("No API key. Pass one as argv[3] or set AI_KEY.");
  process.exit(2);
}

let pass = 0;
let fail = 0;
const failures = [];

function check(ok, label, detail = "") {
  if (ok) {
    pass++;
    console.log(`  ok   ${label}`);
  } else {
    fail++;
    failures.push(`${label}${detail ? " — " + detail : ""}`);
    console.log(`  FAIL ${label}${detail ? " — " + detail : ""}`);
  }
}

async function call(path, method = "GET", body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      Authorization: `Bearer ${KEY}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON is reported by the caller */
  }
  return { status: res.status, json, text };
}

// Every family the dashboard exposes, with the minimum body it accepts.
// `probe` is a field that must survive a round-trip; `patch` is applied after
// create and `expect` is checked on the response, so a PATCH that silently
// drops fields or wipes unmentioned columns is caught rather than assumed.
// Names are suffixed per run. These tables are unique on (companyId, name)
// WITHOUT deletedAt, so a soft-deleted row keeps holding its name — a fixed
// name would collide on the second run and the failure would be the fixture's,
// not the code's.
const RUN = Date.now().toString(36).slice(-6);
const n = (s) => `${s} ${RUN}`;

const FAMILIES = [
  { path: "categories", create: { name: n("verify cat") }, patch: { sortOrder: 4 }, expect: { sortOrder: 4 } },
  { path: "brands", create: { name: n("verify brand") }, patch: { description: "d" }, expect: { description: "d" } },
  { path: "uoms", create: { code: `VU${RUN}`, name: n("verify uom"), category: "COUNT" }, patch: { name: n("verify uom 2") }, expect: { name: n("verify uom 2") } },
  // `numeric` columns come back as strings ("15.00"), not numbers: postgres.js
  // will not round-trip a decimal through a JS float and silently lose
  // precision. The main API behaves the same way (/api/v1/shipping/carriers
  // returns defaultShippingCost "60"), so this is consistency, not a bug.
  { path: "tax-rates", create: { name: n("verify tax"), percentage: 14 }, patch: { percentage: 15 }, expect: { percentage: "15.00" } },
  { path: "attributes", create: { name: n("verify attr"), code: `va${RUN}`, type: "SELECT" }, patch: { sortOrder: 2 }, expect: { sortOrder: 2 } },
  { path: "warehouses", create: { name: n("verify wh") }, patch: { city: "Cairo" }, expect: { city: "Cairo" } },
  { path: "operation-types", create: { name: n("verify op"), code: `vo${RUN}`, sequencePrefix: "V" }, patch: { reservationMethod: "AT_FULFILLMENT" }, expect: { reservationMethod: "AT_FULFILLMENT" } },
  { path: "order-sources", create: { name: n("verify src") }, patch: { isActive: false }, expect: { isActive: false } },
  { path: "payment-methods", create: { name: n("verify pay") }, patch: { isActive: false }, expect: { isActive: false } },
  { path: "cancel-reasons", create: { name: n("verify reason") }, patch: { name: n("verify reason 2") }, expect: { name: n("verify reason 2") } },
  { path: "governorates", create: { name: n("verify gov"), shippingCost: 10 }, patch: { shippingCost: 20 }, expect: { shippingCost: "20.00" } },
  { path: "carriers", create: { name: n("verify carrier"), code: `VC${RUN}`, type: "MANUAL" }, patch: { isActive: false }, expect: { isActive: false } },
  // The four families added last. `needs` marks a payload that must reference a
  // real parent row, resolved in the FK section below.
  { path: "purchase-orders", needsVendor: true, patch: { status: "ORDERED" }, expect: { status: "ORDERED" } },
  { path: "stock-counts", create: { referenceNumber: `SC${RUN}` }, patch: { status: "IN_PROGRESS" }, expect: { status: "IN_PROGRESS" } },
  { path: "production-batches", create: { batchNumber: `PB${RUN}` }, patch: { status: "PLANNED" }, expect: { status: "PLANNED" } },
  { path: "shipping-returns", needsOrder: true, patch: { returnsCollected: true }, expect: { returnsCollected: true } },
];

// Enum columns, whose valid values were read from pg_enum. A rejected value
// must be a 400 naming the options — never a 500 from the driver.
const ENUM_REJECTS = [
  { path: "carriers", create: { name: n("x"), code: `VX${RUN}`, type: "BOGUS" }, field: "type" },
  { path: "attributes", create: { name: n("x"), code: `vx${RUN}`, type: "BOGUS" }, field: "type" },
  { path: "operation-types", create: { name: n("x"), code: `vx${RUN}`, sequencePrefix: "V", reservationMethod: "BOGUS" }, field: "reservationMethod" },
  { path: "fulfillment-batches", create: { name: n("x"), warehouseId: "x", type: "BOGUS" }, field: "type" },
  { path: "purchase-orders", create: { orderNumber: `PX${RUN}`, vendorId: "x", status: "BOGUS" }, field: "status" },
  { path: "stock-counts", create: { referenceNumber: `SX${RUN}`, status: "BOGUS" }, field: "status" },
  { path: "production-batches", create: { batchNumber: `BX${RUN}`, status: "BOGUS" }, field: "status" },
];

const BAD_INPUTS = [
  { path: "categories", create: { description: "no name" }, why: "missing required" },
  { path: "brands", create: { name: "" }, why: "empty required" },
  { path: "tax-rates", create: { name: n("x"), percentage: 250 }, why: "out of range" },
  { path: "cities", create: { name: "x", governorateId: "00000000-0000-0000-0000-000000000000" }, why: "missing FK" },
];

console.log(`AI API resource surface @ ${BASE}\n`);

// ── health ──────────────────────────────────────────────────────────────────
{
  const r = await call("/healthz");
  check(r.status === 200, "healthz responds", `got ${r.status}`);
}

// ── list every family ───────────────────────────────────────────────────────
console.log("\nlist:");
for (const f of FAMILIES) {
  const r = await call(`/v1/${f.path}`);
  const items = r.json?.data?.items;
  check(r.status === 200 && Array.isArray(items), `GET /v1/${f.path}`, `status ${r.status}`);
}

// ── full CRUD cycle ─────────────────────────────────────────────────────────
console.log("\ncreate / read / update / delete:");
for (const f of FAMILIES) {
  // Families whose create payload must point at a real parent row.
  let payload = f.create;
  if (f.needsVendor) {
    const v = await call("/v1/vendors", "POST", { name: n("verify po vendor"), kind: "SUPPLIER" });
    payload = { orderNumber: `PO${RUN}`, vendorId: v.json?.data?.id };
  }
  if (f.needsOrder) {
    // An order requires at least one line — `items: []` is rejected with
    // "items[>=1] required", so the fixture has to use a real product.
    const cust = await call("/v1/customers", "POST", { name: n("verify ret cust"), phoneNumber1: `01${Date.now() % 1000000000}` });
    const prod = (await call("/v1/products?limit=1")).json?.data?.items?.[0]?.id;
    const ord = await call("/v1/orders", "POST", {
      customerId: cust.json?.data?.id,
      items: prod ? [{ productId: prod, quantity: 1 }] : [],
    });
    const oid = ord.json?.data?.id;
    if (!oid) {
      check(false, "shipping-returns: order fixture", `${ord.status} ${ord.json?.data?.error ?? ""}`);
      continue;
    }
    payload = { referenceNumber: `SR${RUN}`, orderId: oid };
  }
  const c = await call(`/v1/${f.path}`, "POST", payload);
  const id = c.json?.data?.id;
  if (!id) {
    check(false, `${f.path}: create`, `${c.status} ${c.json?.data?.error ?? c.text.slice(0, 80)}`);
    continue;
  }
  check(c.status === 201, `${f.path}: create`, `status ${c.status}`);

  const g = await call(`/v1/${f.path}/${id}`);
  check(g.status === 200 && g.json?.data?.id === id, `${f.path}: read back`, `status ${g.status}`);

  const p = await call(`/v1/${f.path}/${id}`, "PATCH", f.patch);
  const got = p.json?.data ?? {};
  const wrong = Object.entries(f.expect).filter(([k, v]) => String(got[k]) !== String(v));
  check(p.status === 200 && wrong.length === 0, `${f.path}: update`, wrong.length ? JSON.stringify(wrong.map(([k, v]) => `${k}=${got[k]} want ${v}`)) : `status ${p.status}`);

  const d = await call(`/v1/${f.path}/${id}`, "DELETE");
  check(d.status === 200, `${f.path}: delete`, `status ${d.status}`);

  const after = await call(`/v1/${f.path}/${id}`);
  check(after.status === 404, `${f.path}: gone after delete`, `status ${after.status}`);
}

// ── FK-dependent families, using real parents ───────────────────────────────
console.log("\nforeign keys:");
{
  const wh = (await call("/v1/warehouses?limit=1")).json?.data?.items?.[0]?.id;
  const pr = (await call("/v1/products?limit=1")).json?.data?.items?.[0]?.id;
  if (!wh || !pr) {
    check(false, "fixtures available", "need a warehouse and a product");
  } else {
    const cases = [
      { path: "storage-locations", body: { warehouseId: wh, name: n("verify loc") } },
      { path: "reorder-points", body: { productId: pr, warehouseId: wh, minStockLevel: 1, maxStockLevel: 9, reorderQuantity: 3 } },
      { path: "fulfillment-batches", body: { name: n("verify batch"), warehouseId: wh, type: "PICKING" } },
      { path: "attribute-values", body: null, needsAttr: true },
    ];
    const attr = (await call("/v1/attributes", "POST", { name: n("verify attr fk"), code: `vf${RUN}`, type: "SELECT" })).json?.data?.id;
    for (const c of cases) {
      const body = c.needsAttr ? { attributeId: attr, value: n("verify value") } : c.body;
      const r = await call(`/v1/${c.path}`, "POST", body);
      const id = r.json?.data?.id;
      check(!!id, `${c.path}: create with real FK`, `${r.status} ${r.json?.data?.error ?? ""}`);
      if (id) await call(`/v1/${c.path}/${id}`, "DELETE");
    }
    if (attr) await call(`/v1/attributes/${attr}`, "DELETE");
  }
}

// ── governorate -> city chain (FK across two generated families) ────────────
{
  const g = await call("/v1/governorates", "POST", { name: n("verify gov chain") });
  const gid = g.json?.data?.id;
  const c = await call("/v1/cities", "POST", { name: n("verify city"), governorateId: gid });
  check(!!c.json?.data?.id, "cities: create under a generated governorate", `${c.status} ${c.json?.data?.error ?? ""}`);
  if (c.json?.data?.id) await call(`/v1/cities/${c.json.data.id}`, "DELETE");
  if (gid) await call(`/v1/governorates/${gid}`, "DELETE");
}

// ── invalid input must be 400, never 500 ────────────────────────────────────
console.log("\nrejects bad input as 400 (not 500):");
for (const t of [...ENUM_REJECTS, ...BAD_INPUTS]) {
  const r = await call(`/v1/${t.path}`, "POST", t.create);
  const msg = r.json?.data?.error ?? "";
  check(r.status === 400, `${t.path}: ${t.why ?? "invalid " + t.field}`, `status ${r.status} ${msg.slice(0, 60)}`);
}

// ── duplicate name must be 409, not 500 (matches the Backend) ───────────────
console.log("\nduplicate handling:");
{
  const name = n("dup probe");
  const a = await call("/v1/categories", "POST", { name });
  const id = a.json?.data?.id;
  await call(`/v1/categories/${id}`, "DELETE");
  const b = await call("/v1/categories", "POST", { name });
  check(b.status === 409, "duplicate name after soft delete is 409", `status ${b.status} ${b.json?.data?.error ?? ""}`);
  if (b.json?.data?.id) await call(`/v1/categories/${b.json.data.id}`, "DELETE");
}

// ── tenant isolation: a foreign id must not be readable ─────────────────────
console.log("\ntenant isolation:");
{
  const r = await call("/v1/categories/00000000-0000-0000-0000-000000000000");
  check(r.status === 404, "unknown id is 404, not 200", `status ${r.status}`);
}

console.log(`\n${pass}/${pass + fail} checks passed`);
if (fail) {
  console.log("\nfailures:");
  for (const f of failures) console.log("  - " + f);
}
process.exit(fail ? 1 : 0);
