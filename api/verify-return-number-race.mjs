// Proves whether the shipping-return reference allocator races.
//
// src/modules/sales/fulfillment.ts allocates the reference as
//     const taken = await tx.shippingReturn.count({ where: { companyId } });
//     const referenceNumber = `RET-${String(taken + 1).padStart(6, "0")}`;
//
// That is read-then-write. Two requests that overlap both read the same count
// and both compute the same number, and (companyId, referenceNumber) is
// UNIQUE — so the loser is expected to fail rather than get a duplicate.
//
// This fires N simultaneous creates and reports, for each: the status, the
// reference returned, and whether every row got a DISTINCT number.
//
// Runs against the real API with the real pool, then deletes exactly the rows
// it created. REDIS_URL is emptied so no limiter can interfere.
process.env.REDIS_URL = "";

const N = Number(process.argv[2] ?? 8);

const { dbAdmin } = await import("./dist/config/database.js");
const { signAccessToken } = await import("./dist/utils/jwt.js");
const app = (await import("./dist/app.js")).default;

const company = await dbAdmin.company.findFirstOrThrow({
  where: { deletedAt: null, owner: { deletedAt: null } },
  select: { id: true, ownerId: true },
});
const user = await dbAdmin.user.findUniqueOrThrow({
  where: { id: company.ownerId },
  select: { id: true, email: true, securityStamp: true, companyId: true, isPlatformAdmin: true },
});
const { token } = signAccessToken({
  sub: user.id, sid: "00000000-0000-4000-8000-000000000000", email: user.email,
  securityStamp: user.securityStamp ?? "", companyId: user.companyId,
  isPlatformAdmin: user.isPlatformAdmin,
});

// A return must name an order that belongs to this company.
const order = await dbAdmin.order.findFirstOrThrow({
  where: { companyId: company.id, deletedAt: null },
  select: { id: true, orderNumber: true },
});

const server = app.listen(0);
await new Promise((r) => server.once("listening", r));
const B = `http://127.0.0.1:${server.address().port}`;
const H = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

// Warm up so pool creation is not part of the race.
await fetch(`${B}/api/v1/catalog/products`, { headers: H });

const body = (i) => JSON.stringify({
  orderId: order.id,
  qtyReturnedGood: 1, qtyReturnedDamaged: 0, qtyReturnedMissing: 0,
  amountTotal: 10 + i, shippingCost: 0,
});

console.log(`Firing ${N} concurrent creates against order ${order.orderNumber}...\n`);

const started = Date.now();
const results = await Promise.all(
  Array.from({ length: N }, async (_, i) => {
    const res = await fetch(`${B}/api/v1/sales/shipping-returns`, {
      method: "POST", headers: H, body: body(i),
    });
    let json = null;
    try { json = await res.json(); } catch { /* non-JSON error page */ }
    return { i, status: res.status, ref: json?.data?.referenceNumber ?? null, id: json?.data?.id ?? null, msg: json?.message ?? null, code: json?.code ?? null };
  })
);
const ms = Date.now() - started;

const ok = results.filter((r) => r.status === 201);
const failed = results.filter((r) => r.status !== 201);
const refs = ok.map((r) => r.ref);
const distinct = new Set(refs);

console.log("status  ref");
for (const r of results.sort((a, b) => a.i - b.i)) {
  console.log(`${String(r.status).padEnd(7)} ${r.ref ?? `—  ${r.code ?? ""} ${r.msg ?? ""}`.slice(0, 90)}`);
}

console.log(`\n201 created : ${ok.length}/${N}`);
console.log(`non-201     : ${failed.length}/${N}`);
console.log(`distinct refs: ${distinct.size}/${refs.length}`);
console.log(`elapsed     : ${ms} ms`);

const codes = {};
for (const r of failed) codes[`${r.status} ${r.code ?? ""}`.trim()] = (codes[`${r.status} ${r.code ?? ""}`.trim()] ?? 0) + 1;
if (Object.keys(codes).length) console.log("failure codes:", codes);

// Clean up only what this script made.
//
// Deleting the returns alone is not enough: the create handler writes an audit
// row per return, and those would be left behind pointing at rows that no
// longer exist. They are removed by the exact return ids this run created —
// matched on entityId, so no audit row from any other run can be caught by it.
// (An earlier version of this cleanup matched on the reference TEXT instead,
// which is not specific to this run and is exactly the kind of too-broad delete
// that removes other people's rows.)
if (refs.length) {
  const ids = ok.map((r) => r.id).filter(Boolean);
  if (ids.length) {
    const delAudit = await dbAdmin.auditLog.deleteMany({
      where: { action: "shippingReturn.created", entityId: { in: ids } },
    });
    if (delAudit.count) console.log(`cleaned up ${delAudit.count} audit row(s).`);
  }
  const del = await dbAdmin.shippingReturn.deleteMany({ where: { referenceNumber: { in: refs } } });
  console.log(`cleaned up ${del.count} row(s) created by this probe.`);
}

server.close();
await dbAdmin.$disconnect();
process.exit(failed.length ? 1 : 0);
