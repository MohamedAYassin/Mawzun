// Exercises the create/update paths I changed by reading, not running.
// They now hydrate through detail(); this proves the response keeps relations.
process.env.REDIS_URL = "";
const { dbAdmin } = await import("./dist/config/database.js");
const { signAccessToken } = await import("./dist/utils/jwt.js");
const app = (await import("./dist/app.js")).default;

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
const H = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

const stamp = Date.now();
const sku = `VERIFY-${stamp}`;

// CREATE a product — the response must carry the detail relations.
const createRes = await fetch(`${B}/api/v1/catalog/products`, {
  method: "POST",
  headers: H,
  body: JSON.stringify({
    name: `منتج تحقق ${stamp}`,
    slug: `verify-${stamp}`,
    skuCode: sku,
    price: 10,
    costPrice: 5,
    trackStock: true,
  }),
});
const createBody = await createRes.json();
console.log(`CREATE -> ${createRes.status}`);
if (createRes.status < 300 && createBody.data) {
  const row = createBody.data;
  const need = ["category", "brand", "uom", "images", "variants", "stockLevels"];
  const missing = need.filter((k) => !(k in row));
  console.log(missing.length ? `  FAIL missing: ${missing.join(", ")}` : "  PASS relations present");
  console.log(`  (name echoed: ${row.name ? "yes" : "NO — summary field lost"})`);

  // UPDATE it — same expectation.
  const id = row.id;
  const updRes = await fetch(`${B}/api/v1/catalog/products/${id}`, {
    method: "PATCH",
    headers: H,
    body: JSON.stringify({ price: 12 }),
  });
  const updBody = await updRes.json();
  console.log(`UPDATE -> ${updRes.status}`);
  if (updRes.status < 300 && updBody.data) {
    const missing2 = need.filter((k) => !(k in updBody.data));
    console.log(missing2.length ? `  FAIL missing: ${missing2.join(", ")}` : "  PASS relations present");
  } else {
    console.log(`  body: ${JSON.stringify(updBody).slice(0, 200)}`);
  }

  // Clean up: hard delete the row this script made.
  await dbAdmin.product.delete({ where: { id } }).catch(() => {});
  console.log("  cleaned up test product");
} else {
  console.log(`  body: ${JSON.stringify(createBody).slice(0, 300)}`);
}

server.close();
process.exit(0);
