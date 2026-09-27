// Mawzun AI API — v1 write surface for agents.
//
// Same route table, same company scope as reads: every mutation binds
// "companyId" explicitly and never touches another tenant's rows. Business
// rules mirror the Backend handlers (see the per-endpoint notes); anything
// the dashboard computes with multi-service context (e.g. coupon floors are
// validated here, stock commit on CONFIRMED is ported) is re-checked in SQL.
//
// Conventions: ids are crypto.randomUUID(), updatedAt is set explicitly
// (Prisma's @updatedAt is client-side, so raw SQL must write it), money is
// rounded to 2 decimals, timestamps come from now().

import type { Sql } from "./auth";
import { json, type HandlerCtx, type Route } from "./routes";

const writeRoutes: Route[] = [];

function post(pattern: string, handler: Route["handler"]) {
  writeRoutes.push({ method: "POST", segments: pattern.split("/").filter(Boolean), handler });
}

function patch(pattern: string, handler: Route["handler"]) {
  writeRoutes.push({ method: "PATCH", segments: pattern.split("/").filter(Boolean), handler });
}

function del(pattern: string, handler: Route["handler"]) {
  writeRoutes.push({ method: "DELETE", segments: pattern.split("/").filter(Boolean), handler });
}

// ── helpers ─────────────────────────────────────────────────────────────────
type Body = Record<string, unknown>;

function bodyOf(ctx?: HandlerCtx): Body {
  const b = ctx?.body;
  return b && typeof b === "object" ? (b as Body) : {};
}

const newId = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();
const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};
const reqStr = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s === "" ? null : s;
};

function slugify(name: string): string {
  const s = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || `product-${Date.now().toString(36)}`;
}

async function mustExist(
  sql: Sql,
  companyId: string,
  table: string,
  id: unknown,
  label: string
): Promise<void> {
  const v = reqStr(id);
  if (!v) throw { status: 400, message: `${label} is required` };
  // Table/column identifiers are fixed literals per call site, never input.
  const rows = await sql`SELECT id FROM ${sql(table)} WHERE "companyId" = ${companyId} AND id = ${v} AND "deletedAt" IS NULL LIMIT 1`;
  if (rows.length === 0) throw { status: 400, message: `${label} not found` };
}

async function mustExistOpt(
  sql: Sql,
  companyId: string,
  table: string,
  id: unknown,
  label: string
): Promise<string | null> {
  const v = str(id);
  if (!v) return null;
  const rows = await sql`SELECT id FROM ${sql(table)} WHERE "companyId" = ${companyId} AND id = ${v} AND "deletedAt" IS NULL LIMIT 1`;
  if (rows.length === 0) throw { status: 400, message: `${label} not found` };
  return v;
}

function fail(err: unknown): Response {
  if (err && typeof err === "object" && "status" in err) {
    const e = err as { status: number; message: string };
    return json({ error: e.message }, e.status);
  }
  throw err;
}

// ── products ────────────────────────────────────────────────────────────────
const PRODUCT_COLS = `id, name, slug, description, "skuCode", barcode, "isActive", "categoryId", "brandId", "uomId", price, "priceBeforeDiscount", "costPrice", "weightKg", "trackStock", "trackExpiry", "salesTaxRateId", "purchaseTaxRateId", "archivedAt"`;

async function checkSkuUnique(sql: Sql, companyId: string, sku: string, exceptId?: string): Promise<void> {
  const clash = exceptId
    ? await sql`SELECT id FROM products WHERE "companyId" = ${companyId} AND "skuCode" = ${sku} AND "deletedAt" IS NULL AND id != ${exceptId} LIMIT 1`
    : await sql`SELECT id FROM products WHERE "companyId" = ${companyId} AND "skuCode" = ${sku} AND "deletedAt" IS NULL LIMIT 1`;
  if (clash.length > 0) throw { status: 409, message: "skuCode already exists" };
}

async function checkFk(sql: Sql, companyId: string, table: string, id: unknown, label: string): Promise<string | null> {
  const v = str(id);
  if (!v) return null;
  const rows = await sql`SELECT id FROM ${sql(table)} WHERE "companyId" = ${companyId} AND id = ${v} AND "deletedAt" IS NULL LIMIT 1`;
  if (rows.length === 0) throw { status: 400, message: `${label} not found` };
  return v;
}

async function insertImages(sql: Sql, companyId: string, productId: string, images: unknown): Promise<void> {
  if (!Array.isArray(images)) return;
  if (images.length > 20) throw { status: 400, message: "max 20 images" };
  let i = 0;
  for (const im of images) {
    const o = (im ?? {}) as Record<string, unknown>;
    const url = reqStr(o.imageUrl);
    if (!url || url.length > 2000) throw { status: 400, message: "image.imageUrl required (max 2000)" };
    await sql`INSERT INTO product_images (id, "createdAt", "updatedAt", "companyId", "productId", "imageUrl", "altText", "sortOrder", "isPrimary")
      VALUES (${newId()}, now(), ${nowIso()}, ${companyId}, ${productId}, ${url}, ${str(o.altText)}, ${Number.isInteger(o.sortOrder) ? o.sortOrder as number : i}, ${o.isPrimary === true})`;
    i++;
  }
}

post("/v1/products", async (sql, companyId, _p, _u, ctx) => {
  try {
    const b = bodyOf(ctx);
    const name = reqStr(b.name);
    if (!name || name.length > 255) throw { status: 400, message: "name required (1..255)" };
    const price = num(b.price);
    const costPrice = num(b.costPrice);
    if (price < 0 || price > 99999999 || costPrice < 0 || costPrice > 99999999) {
      throw { status: 400, message: "price/costPrice must be 0..99999999" };
    }
    const weightKg = b.weightKg === null || b.weightKg === undefined ? null : num(b.weightKg);
    if (weightKg !== null && (weightKg < 0 || weightKg > 999999)) throw { status: 400, message: "weightKg must be 0..999999" };
    const sku = str(b.skuCode);
    if (sku && sku.length > 100) throw { status: 400, message: "skuCode max 100" };
    if (sku) await checkSkuUnique(sql, companyId, sku);
    const barcode = str(b.barcode);
    if (barcode && barcode.length > 100) throw { status: 400, message: "barcode max 100" };
    const categoryId = await checkFk(sql, companyId, "categories", b.categoryId, "categoryId");
    const brandId = await checkFk(sql, companyId, "brands", b.brandId, "brandId");
    const uomId = await checkFk(sql, companyId, "uoms", b.uomId, "uomId");
    const salesTaxRateId = await checkFk(sql, companyId, "tax_rates", b.salesTaxRateId, "salesTaxRateId");
    const purchaseTaxRateId = await checkFk(sql, companyId, "tax_rates", b.purchaseTaxRateId, "purchaseTaxRateId");
    const id = newId();
    await sql`INSERT INTO products (id, "createdAt", "updatedAt", "companyId", name, slug, description, "skuCode", barcode,
        "isActive", "categoryId", "brandId", "uomId", price, "priceBeforeDiscount", "costPrice", "weightKg",
        "trackStock", "trackExpiry", "salesTaxRateId", "purchaseTaxRateId")
      VALUES (${id}, now(), ${nowIso()}, ${companyId}, ${name}, ${slugify(name)}, ${str(b.description)},
        ${sku}, ${barcode}, ${b.isActive === false ? false : true}, ${categoryId}, ${brandId}, ${uomId},
        ${price}, ${b.priceBeforeDiscount === null || b.priceBeforeDiscount === undefined ? null : num(b.priceBeforeDiscount)},
        ${costPrice}, ${weightKg}, ${b.trackStock === false ? false : true}, ${b.trackExpiry === true},
        ${salesTaxRateId}, ${purchaseTaxRateId})`;
    await insertImages(sql, companyId, id, b.images);
    const rows = await sql`SELECT ${sql.unsafe(PRODUCT_COLS)} FROM products WHERE id = ${id}`;
    return json(rows[0], 201);
  } catch (e) {
    return fail(e);
  }
});

patch("/v1/products/:id", async (sql, companyId, p, _u, ctx) => {
  try {
    const b = bodyOf(ctx);
    const cur = await sql`SELECT id FROM products WHERE "companyId" = ${companyId} AND id = ${p.id} AND "deletedAt" IS NULL`;
    if (cur.length === 0) return json({ error: "product not found" }, 404);
    const sets: string[] = [];
    const vals: (string | number | boolean | null)[] = [];
    const set = (col: string, v: unknown) => {
      vals.push(v as string | number | boolean | null);
      sets.push(`"${col}" = $${vals.length}`);
    };
    if (b.name !== undefined) {
      const name = reqStr(b.name);
      if (!name || name.length > 255) throw { status: 400, message: "name must be 1..255" };
      set("name", name);
      vals.push(slugify(name));
      sets.push(`"slug" = $${vals.length}`);
    }
    if (b.skuCode !== undefined) {
      const sku = str(b.skuCode);
      if (sku && sku.length > 100) throw { status: 400, message: "skuCode max 100" };
      if (sku) await checkSkuUnique(sql, companyId, sku, p.id);
      set("skuCode", sku);
    }
    if (b.barcode !== undefined) {
      const bc = str(b.barcode);
      if (bc && bc.length > 100) throw { status: 400, message: "barcode max 100" };
      set("barcode", bc);
    }
    for (const f of ["description", "price", "priceBeforeDiscount", "costPrice", "weightKg", "isActive", "trackStock", "trackExpiry"] as const) {
      if (b[f] !== undefined) set(f, b[f] === null ? null : b[f]);
    }
    if (b.categoryId !== undefined) set("categoryId", await checkFk(sql, companyId, "categories", b.categoryId, "categoryId"));
    if (b.brandId !== undefined) set("brandId", await checkFk(sql, companyId, "brands", b.brandId, "brandId"));
    if (b.uomId !== undefined) set("uomId", await checkFk(sql, companyId, "uoms", b.uomId, "uomId"));
    if (b.salesTaxRateId !== undefined) set("salesTaxRateId", await checkFk(sql, companyId, "tax_rates", b.salesTaxRateId, "salesTaxRateId"));
    if (b.purchaseTaxRateId !== undefined) set("purchaseTaxRateId", await checkFk(sql, companyId, "tax_rates", b.purchaseTaxRateId, "purchaseTaxRateId"));
    if (b.archived !== undefined) set("archivedAt", b.archived === true ? nowIso() : null);
    if (sets.length > 0) {
      vals.push(nowIso());
      sets.push(`"updatedAt" = $${vals.length}`);
      // Sets are fixed column names; values are bound positionally.
      await sql.unsafe(
        `UPDATE products SET ${sets.join(", ")} WHERE id = $${vals.length + 1} AND "companyId" = $${vals.length + 2}`,
        [...vals, p.id, companyId]
      );
    }
    if (b.images !== undefined) {
      if (b.images !== null && !Array.isArray(b.images)) throw { status: 400, message: "images must be an array or null" };
      await sql`DELETE FROM product_images WHERE "productId" = ${p.id}`;
      if (Array.isArray(b.images)) await insertImages(sql, companyId, p.id, b.images);
    }
    const rows = await sql`SELECT ${sql.unsafe(PRODUCT_COLS)} FROM products WHERE id = ${p.id}`;
    return json(rows[0]);
  } catch (e) {
    return fail(e);
  }
});

del("/v1/products/:id", async (sql, companyId, p) => {
  const cur = await sql`UPDATE products SET "deletedAt" = now(), "updatedAt" = ${nowIso()}, "isActive" = false
    WHERE "companyId" = ${companyId} AND id = ${p.id} AND "deletedAt" IS NULL RETURNING id`;
  if (cur.length === 0) return json({ error: "product not found" }, 404);
  return json({ deleted: true, id: p.id });
});

// ── customers ───────────────────────────────────────────────────────────────
const CUSTOMER_COLS = `id, name, "phoneNumber1", "phoneNumber2", email, address, notes, "isActive"`;

async function checkPhoneUnique(sql: Sql, companyId: string, phone: string, exceptId?: string): Promise<void> {
  const clash = exceptId
    ? await sql`SELECT id FROM customers WHERE "companyId" = ${companyId} AND "phoneNumber1" = ${phone} AND "deletedAt" IS NULL AND id != ${exceptId} LIMIT 1`
    : await sql`SELECT id FROM customers WHERE "companyId" = ${companyId} AND "phoneNumber1" = ${phone} AND "deletedAt" IS NULL LIMIT 1`;
  if (clash.length > 0) throw { status: 409, message: "phoneNumber1 already exists" };
}

function validEmail(v: string | null): string | null {
  if (!v) return null;
  const e = v.toLowerCase();
  if (e.length > 200 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw { status: 400, message: "invalid email" };
  return e;
}

post("/v1/customers", async (sql, companyId, _p, _u, ctx) => {
  try {
    const b = bodyOf(ctx);
    const name = reqStr(b.name);
    const phone = reqStr(b.phoneNumber1);
    if (!name || name.length > 255) throw { status: 400, message: "name required (1..255)" };
    if (!phone || phone.length > 50) throw { status: 400, message: "phoneNumber1 required (1..50)" };
    await checkPhoneUnique(sql, companyId, phone);
    const id = newId();
    await sql`INSERT INTO customers (id, "createdAt", "updatedAt", "companyId", name, "phoneNumber1", "phoneNumber2", email, address, notes, "isActive")
      VALUES (${id}, now(), ${nowIso()}, ${companyId}, ${name}, ${phone}, ${str(b.phoneNumber2)}, ${validEmail(str(b.email))},
        ${str(b.address)}, ${str(b.notes)}, ${b.isActive === false ? false : true})`;
    const rows = await sql`SELECT ${sql.unsafe(CUSTOMER_COLS)} FROM customers WHERE id = ${id}`;
    return json(rows[0], 201);
  } catch (e) {
    return fail(e);
  }
});

post("/v1/customers/find-or-create", async (sql, companyId, _p, _u, ctx) => {
  try {
    const b = bodyOf(ctx);
    const phone = reqStr(b.phoneNumber1);
    if (phone) {
      const found = await sql`SELECT ${sql.unsafe(CUSTOMER_COLS)} FROM customers
        WHERE "companyId" = ${companyId} AND "phoneNumber1" = ${phone} AND "deletedAt" IS NULL LIMIT 1`;
      if (found.length > 0) return json({ customer: found[0], created: false });
    }
    const name = reqStr(b.name);
    if (!name || name.length > 255) throw { status: 400, message: "name required (1..255)" };
    if (!phone || phone.length > 50) throw { status: 400, message: "phoneNumber1 required (1..50)" };
    const id = newId();
    await sql`INSERT INTO customers (id, "createdAt", "updatedAt", "companyId", name, "phoneNumber1", "phoneNumber2", email, address, notes, "isActive")
      VALUES (${id}, now(), ${nowIso()}, ${companyId}, ${name}, ${phone}, ${str(b.phoneNumber2)}, ${validEmail(str(b.email))},
        ${str(b.address)}, ${str(b.notes)}, true)`;
    const rows = await sql`SELECT ${sql.unsafe(CUSTOMER_COLS)} FROM customers WHERE id = ${id}`;
    return json({ customer: rows[0], created: true }, 201);
  } catch (e) {
    return fail(e);
  }
});

patch("/v1/customers/:id", async (sql, companyId, p, _u, ctx) => {
  try {
    const b = bodyOf(ctx);
    const cur = await sql`SELECT id FROM customers WHERE "companyId" = ${companyId} AND id = ${p.id} AND "deletedAt" IS NULL`;
    if (cur.length === 0) return json({ error: "customer not found" }, 404);
    const sets: string[] = [];
    const vals: (string | number | boolean | null)[] = [];
    const set = (col: string, v: unknown) => {
      vals.push(v as string | number | boolean | null);
      sets.push(`"${col}" = $${vals.length}`);
    };
    if (b.name !== undefined) {
      const name = reqStr(b.name);
      if (!name || name.length > 255) throw { status: 400, message: "name must be 1..255" };
      set("name", name);
    }
    if (b.phoneNumber1 !== undefined) {
      const phone = reqStr(b.phoneNumber1);
      if (!phone || phone.length > 50) throw { status: 400, message: "phoneNumber1 must be 1..50" };
      await checkPhoneUnique(sql, companyId, phone, p.id);
      set("phoneNumber1", phone);
    }
    if (b.phoneNumber2 !== undefined) set("phoneNumber2", str(b.phoneNumber2));
    if (b.email !== undefined) set("email", validEmail(str(b.email)));
    if (b.address !== undefined) set("address", str(b.address));
    if (b.notes !== undefined) set("notes", str(b.notes));
    if (b.isActive !== undefined) set("isActive", b.isActive === true);
    if (sets.length > 0) {
      vals.push(nowIso());
      sets.push(`"updatedAt" = $${vals.length}`);
      await sql.unsafe(
        `UPDATE customers SET ${sets.join(", ")} WHERE id = $${vals.length + 1} AND "companyId" = $${vals.length + 2}`,
        [...vals, p.id, companyId]
      );
    }
    const rows = await sql`SELECT ${sql.unsafe(CUSTOMER_COLS)} FROM customers WHERE id = ${p.id}`;
    return json(rows[0]);
  } catch (e) {
    return fail(e);
  }
});

del("/v1/customers/:id", async (sql, companyId, p) => {
  const cur = await sql`UPDATE customers SET "deletedAt" = now(), "updatedAt" = ${nowIso()}, "isActive" = false
    WHERE "companyId" = ${companyId} AND id = ${p.id} AND "deletedAt" IS NULL RETURNING id`;
  if (cur.length === 0) return json({ error: "customer not found" }, 404);
  return json({ deleted: true, id: p.id });
});

// ── coupons ─────────────────────────────────────────────────────────────────
const COUPON_COLS = `id, code, "discountType", value, "minOrderTotal", "maxRedemptions", "redemptionCount", "expiresAt", "isActive"`;

async function checkCodeUnique(sql: Sql, companyId: string, code: string, exceptId?: string): Promise<void> {
  const clash = exceptId
    ? await sql`SELECT id FROM coupons WHERE "companyId" = ${companyId} AND code = ${code} AND "deletedAt" IS NULL AND id != ${exceptId} LIMIT 1`
    : await sql`SELECT id FROM coupons WHERE "companyId" = ${companyId} AND code = ${code} AND "deletedAt" IS NULL LIMIT 1`;
  if (clash.length > 0) throw { status: 409, message: "code already exists" };
}

function couponValue(discountType: string, value: unknown): number {
  const v = num(value);
  if (discountType === "PERCENTAGE" && (v < 0 || v > 100)) throw { status: 400, message: "PERCENTAGE value must be 0..100" };
  if (discountType === "FIXED" && v <= 0) throw { status: 400, message: "FIXED value must be > 0" };
  return v;
}

post("/v1/coupons", async (sql, companyId, _p, _u, ctx) => {
  try {
    const b = bodyOf(ctx);
    const rawCode = reqStr(b.code);
    if (!rawCode || rawCode.length > 60) throw { status: 400, message: "code required (1..60)" };
    const code = rawCode.toUpperCase();
    const discountType = b.discountType === "FIXED" ? "FIXED" : "PERCENTAGE";
    const value = couponValue(discountType, b.value ?? 0);
    await checkCodeUnique(sql, companyId, code);
    const minOrderTotal = b.minOrderTotal === null || b.minOrderTotal === undefined ? null : num(b.minOrderTotal);
    if (minOrderTotal !== null && minOrderTotal < 0) throw { status: 400, message: "minOrderTotal must be >= 0" };
    const maxRedemptions = b.maxRedemptions === null || b.maxRedemptions === undefined ? null : num(b.maxRedemptions);
    if (maxRedemptions !== null && (!Number.isInteger(maxRedemptions) || maxRedemptions < 1)) {
      throw { status: 400, message: "maxRedemptions must be an integer >= 1" };
    }
    const id = newId();
    await sql`INSERT INTO coupons (id, "createdAt", "updatedAt", "companyId", code, "discountType", value,
        "minOrderTotal", "maxRedemptions", "redemptionCount", "expiresAt", "isActive")
      VALUES (${id}, now(), ${nowIso()}, ${companyId}, ${code}, ${discountType}, ${value},
        ${minOrderTotal}, ${maxRedemptions}, 0, ${str(b.expiresAt)}, ${b.isActive === false ? false : true})`;
    const rows = await sql`SELECT ${sql.unsafe(COUPON_COLS)}, "expiresAt"::text AS "expiresAtText" FROM coupons WHERE id = ${id}`;
    return json(rows[0], 201);
  } catch (e) {
    return fail(e);
  }
});

patch("/v1/coupons/:id", async (sql, companyId, p, _u, ctx) => {
  try {
    const b = bodyOf(ctx);
    const cur = await sql`SELECT id FROM coupons WHERE "companyId" = ${companyId} AND id = ${p.id} AND "deletedAt" IS NULL`;
    if (cur.length === 0) return json({ error: "coupon not found" }, 404);
    const sets: string[] = [];
    const vals: (string | number | boolean | null)[] = [];
    const set = (col: string, v: unknown) => {
      vals.push(v as string | number | boolean | null);
      sets.push(`"${col}" = $${vals.length}`);
    };
    let discountType: string | null = null;
    if (b.code !== undefined) {
      const rawCode = reqStr(b.code);
      if (!rawCode || rawCode.length > 60) throw { status: 400, message: "code must be 1..60" };
      await checkCodeUnique(sql, companyId, rawCode.toUpperCase(), p.id);
      set("code", rawCode.toUpperCase());
    }
    if (b.discountType !== undefined) {
      if (b.discountType !== "PERCENTAGE" && b.discountType !== "FIXED") throw { status: 400, message: "discountType must be PERCENTAGE|FIXED" };
      discountType = b.discountType;
      set("discountType", discountType);
    } else {
      const t = await sql`SELECT "discountType" FROM coupons WHERE id = ${p.id}`;
      discountType = t[0].discountType as string;
    }
    if (b.value !== undefined) set("value", couponValue(discountType, b.value));
    else if (b.discountType !== undefined) {
      // Type changed without a value: re-validate the stored value under the new type.
      const t = await sql`SELECT value FROM coupons WHERE id = ${p.id}`;
      couponValue(discountType, Number(t[0].value));
    }
    if (b.minOrderTotal !== undefined) {
      const v = b.minOrderTotal === null ? null : num(b.minOrderTotal);
      if (v !== null && v < 0) throw { status: 400, message: "minOrderTotal must be >= 0" };
      set("minOrderTotal", v);
    }
    if (b.maxRedemptions !== undefined) {
      const v = b.maxRedemptions === null ? null : num(b.maxRedemptions);
      if (v !== null && (!Number.isInteger(v) || v < 1)) throw { status: 400, message: "maxRedemptions must be an integer >= 1" };
      set("maxRedemptions", v);
    }
    if (b.expiresAt !== undefined) set("expiresAt", str(b.expiresAt));
    if (b.isActive !== undefined) set("isActive", b.isActive === true);
    if (sets.length > 0) {
      vals.push(nowIso());
      sets.push(`"updatedAt" = $${vals.length}`);
      await sql.unsafe(
        `UPDATE coupons SET ${sets.join(", ")} WHERE id = $${vals.length + 1} AND "companyId" = $${vals.length + 2}`,
        [...vals, p.id, companyId]
      );
    }
    const rows = await sql`SELECT ${sql.unsafe(COUPON_COLS)} FROM coupons WHERE id = ${p.id}`;
    return json(rows[0]);
  } catch (e) {
    return fail(e);
  }
});

del("/v1/coupons/:id", async (sql, companyId, p) => {
  const cur = await sql`UPDATE coupons SET "deletedAt" = now(), "updatedAt" = ${nowIso()}, "isActive" = false
    WHERE "companyId" = ${companyId} AND id = ${p.id} AND "deletedAt" IS NULL RETURNING id`;
  if (cur.length === 0) return json({ error: "coupon not found" }, 404);
  return json({ deleted: true, id: p.id });
});

// ── vendors ─────────────────────────────────────────────────────────────────
const VENDOR_COLS = `id, kind, name, "contactPerson", "phoneNumber", email, address, "taxNumber", notes, "isActive", "commissionRate"`;

function vendorEmail(v: string | null): string {
  if (!v) return "";
  const e = v.toLowerCase();
  if (e.length > 150 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw { status: 400, message: "invalid email" };
  return e;
}

post("/v1/vendors", async (sql, companyId, _p, _u, ctx) => {
  try {
    const b = bodyOf(ctx);
    const name = reqStr(b.name);
    if (!name || name.length > 150) throw { status: 400, message: "name required (1..150)" };
    const kind = b.kind === "CONSIGNMENT" ? "CONSIGNMENT" : "SUPPLIER";
    const commissionRate = num(b.commissionRate);
    if (commissionRate < 0 || commissionRate > 100) throw { status: 400, message: "commissionRate must be 0..100" };
    const id = newId();
    await sql`INSERT INTO vendors (id, "createdAt", "updatedAt", "companyId", kind, name, "contactPerson", "phoneNumber",
        email, address, "taxNumber", notes, "isActive", "commissionRate")
      VALUES (${id}, now(), ${nowIso()}, ${companyId}, ${kind}, ${name}, ${str(b.contactPerson) ?? ""},
        ${str(b.phoneNumber) ?? ""}, ${vendorEmail(str(b.email))}, ${str(b.address) ?? ""}, ${str(b.taxNumber)},
        ${str(b.notes) ?? ""}, ${b.isActive === false ? false : true}, ${commissionRate})`;
    const rows = await sql`SELECT ${sql.unsafe(VENDOR_COLS)} FROM vendors WHERE id = ${id}`;
    return json(rows[0], 201);
  } catch (e) {
    return fail(e);
  }
});

patch("/v1/vendors/:id", async (sql, companyId, p, _u, ctx) => {
  try {
    const b = bodyOf(ctx);
    const cur = await sql`SELECT id FROM vendors WHERE "companyId" = ${companyId} AND id = ${p.id} AND "deletedAt" IS NULL`;
    if (cur.length === 0) return json({ error: "vendor not found" }, 404);
    const sets: string[] = [];
    const vals: (string | number | boolean | null)[] = [];
    const set = (col: string, v: unknown) => {
      vals.push(v as string | number | boolean | null);
      sets.push(`"${col}" = $${vals.length}`);
    };
    if (b.name !== undefined) {
      const name = reqStr(b.name);
      if (!name || name.length > 150) throw { status: 400, message: "name must be 1..150" };
      set("name", name);
    }
    if (b.kind !== undefined) {
      if (b.kind !== "SUPPLIER" && b.kind !== "CONSIGNMENT") throw { status: 400, message: "kind must be SUPPLIER|CONSIGNMENT" };
      set("kind", b.kind);
    }
    if (b.contactPerson !== undefined) set("contactPerson", str(b.contactPerson) ?? "");
    if (b.phoneNumber !== undefined) set("phoneNumber", str(b.phoneNumber) ?? "");
    if (b.email !== undefined) set("email", vendorEmail(str(b.email)));
    if (b.address !== undefined) set("address", str(b.address) ?? "");
    if (b.taxNumber !== undefined) set("taxNumber", str(b.taxNumber));
    if (b.notes !== undefined) set("notes", str(b.notes) ?? "");
    if (b.isActive !== undefined) set("isActive", b.isActive === true);
    if (b.commissionRate !== undefined) {
      const v = num(b.commissionRate);
      if (v < 0 || v > 100) throw { status: 400, message: "commissionRate must be 0..100" };
      set("commissionRate", v);
    }
    if (sets.length > 0) {
      vals.push(nowIso());
      sets.push(`"updatedAt" = $${vals.length}`);
      await sql.unsafe(
        `UPDATE vendors SET ${sets.join(", ")} WHERE id = $${vals.length + 1} AND "companyId" = $${vals.length + 2}`,
        [...vals, p.id, companyId]
      );
    }
    const rows = await sql`SELECT ${sql.unsafe(VENDOR_COLS)} FROM vendors WHERE id = ${p.id}`;
    return json(rows[0]);
  } catch (e) {
    return fail(e);
  }
});

del("/v1/vendors/:id", async (sql, companyId, p) => {
  const cur = await sql`SELECT id FROM vendors WHERE "companyId" = ${companyId} AND id = ${p.id} AND "deletedAt" IS NULL`;
  if (cur.length === 0) return json({ error: "vendor not found" }, 404);
  await sql`UPDATE vendors SET "deletedAt" = now(), "updatedAt" = ${nowIso()}, "isActive" = false
    WHERE "companyId" = ${companyId} AND id = ${p.id}`;
  return json({ deleted: true, id: p.id });
});

// ── orders ──────────────────────────────────────────────────────────────────
const ORDER_STATUSES = ["NEW", "CONFIRMED", "POSTPONED", "CANCELLED", "NO_ANSWER", "DELIVERED", "RETURNED", "NOT_DELIVERED", "ON_THE_WAY", "RETURNED_TO_WAREHOUSE"];

interface CouponCheck {
  couponId: string;
  fixed: number;
}

async function checkCoupon(sql: Sql, companyId: string, code: string, orderTotal: number): Promise<CouponCheck> {
  const rows = await sql`SELECT id, "discountType", value, "minOrderTotal", "maxRedemptions", "redemptionCount", "expiresAt", "isActive"
    FROM coupons WHERE "companyId" = ${companyId} AND code = ${code.toUpperCase()} AND "deletedAt" IS NULL LIMIT 1`;
  if (rows.length === 0) throw { status: 400, message: "invalid coupon code" };
  const c = rows[0] as Record<string, unknown>;
  if (c.isActive !== true) throw { status: 400, message: "coupon is inactive" };
  if (c.expiresAt && new Date(c.expiresAt as string).getTime() < Date.now()) throw { status: 400, message: "coupon expired" };
  if (c.maxRedemptions !== null && c.maxRedemptions !== undefined && Number(c.redemptionCount) >= Number(c.maxRedemptions)) {
    throw { status: 400, message: "coupon redemption limit reached" };
  }
  if (c.minOrderTotal !== null && c.minOrderTotal !== undefined && orderTotal < Number(c.minOrderTotal)) {
    throw { status: 400, message: "order total below coupon minimum" };
  }
  const fixed =
    c.discountType === "PERCENTAGE"
      ? Math.min((Number(c.value) / 100) * orderTotal, orderTotal)
      : Math.min(Number(c.value), orderTotal);
  return { couponId: c.id as string, fixed: round2(fixed) };
}

interface PricedLine {
  productId: string;
  quantity: number;
  unitPrice: number;
  unitCost: number;
  itemDiscountPercentage: number;
  itemDiscountAmount: number;
  discountType: string;
  lineTotal: number;
}

async function priceLines(
  sql: Sql,
  companyId: string,
  items: unknown
): Promise<{ lines: PricedLine[]; subtotal: number }> {
  if (!Array.isArray(items) || items.length === 0) throw { status: 400, message: "items[>=1] required" };
  const ids = [...new Set(items.map((i) => (i as Record<string, unknown>)?.productId).filter((v) => typeof v === "string"))] as string[];
  if (ids.length !== items.length) throw { status: 400, message: "every item needs a productId" };
  const prods = await sql`SELECT id, price, "costPrice", "trackStock" FROM products
    WHERE "companyId" = ${companyId} AND id = ANY(${ids}) AND "deletedAt" IS NULL`;
  if (prods.length !== ids.length) throw { status: 400, message: "one or more products not found" };
  const byId = new Map((prods as Record<string, unknown>[]).map((r) => [r.id as string, r]));
  const lines: PricedLine[] = [];
  let subtotal = 0;
  for (const raw of items) {
    const it = raw as Record<string, unknown>;
    const quantity = num(it.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) throw { status: 400, message: "item quantity must be > 0" };
    const pr = byId.get(it.productId as string) as Record<string, unknown>;
    const unitPrice = num(it.unitPrice) > 0 ? num(it.unitPrice) : Number(pr.price);
    const unitCost = it.unitCost === undefined || it.unitCost === null ? Number(pr.costPrice ?? 0) : num(it.unitCost);
    const discountType = it.discountType === "FIXED" ? "FIXED" : "PERCENTAGE";
    const itemDiscountPercentage = discountType === "PERCENTAGE" ? num(it.itemDiscountPercentage) : 0;
    const itemDiscountAmount = discountType === "FIXED" ? num(it.itemDiscountAmount) : 0;
    if (itemDiscountPercentage < 0 || itemDiscountPercentage > 100) throw { status: 400, message: "itemDiscountPercentage must be 0..100" };
    const gross = quantity * unitPrice;
    const discount =
      discountType === "PERCENTAGE" ? (gross * itemDiscountPercentage) / 100 : Math.min(itemDiscountAmount, gross);
    const lineTotal = round2(Math.max(0, gross - discount));
    subtotal = round2(subtotal + lineTotal);
    lines.push({
      productId: it.productId as string,
      quantity,
      unitPrice: round2(unitPrice),
      unitCost: round2(unitCost),
      itemDiscountPercentage,
      itemDiscountAmount: round2(itemDiscountAmount),
      discountType,
      lineTotal,
    });
  }
  return { lines, subtotal };
}

async function nextOrderNumber(sql: Sql, companyId: string): Promise<string> {
  const rows = await sql`INSERT INTO company_settings (id, "companyId", "orderPrefix", "orderNextNumber", "createdAt", "updatedAt")
    VALUES (${newId()}, ${companyId}, 'ORD', 2, now(), ${nowIso()})
    ON CONFLICT ("companyId") DO UPDATE SET "orderNextNumber" = company_settings."orderNextNumber" + 1, "updatedAt" = ${nowIso()}
    RETURNING "orderPrefix", "orderNextNumber"`;
  const r = rows[0] as Record<string, unknown>;
  return `${r.orderPrefix}-${String(Number(r.orderNextNumber) - 1).padStart(6, "0")}`;
}

async function companySettings(sql: Sql, companyId: string): Promise<{ stockCommitPoint: string; allowNegativeStock: boolean }> {
  const rows = await sql`SELECT "stockCommitPoint", "allowNegativeStock" FROM company_settings WHERE "companyId" = ${companyId} LIMIT 1`;
  if (rows.length === 0) return { stockCommitPoint: "CONFIRMATION", allowNegativeStock: false };
  return {
    stockCommitPoint: (rows[0] as Record<string, unknown>).stockCommitPoint as string,
    allowNegativeStock: (rows[0] as Record<string, unknown>).allowNegativeStock === true,
  };
}

async function defaultWarehouse(sql: Sql, companyId: string): Promise<string | null> {
  const rows = await sql`SELECT id FROM warehouses WHERE "companyId" = ${companyId} AND "isDefault" = true AND "deletedAt" IS NULL LIMIT 1`;
  return rows.length > 0 ? (rows[0] as Record<string, unknown>).id as string : null;
}

async function rootLocation(sql: Sql, companyId: string, warehouseId: string): Promise<string | null> {
  const rows = await sql`SELECT id FROM storage_locations
    WHERE "companyId" = ${companyId} AND "warehouseId" = ${warehouseId} AND "isActive" = true
      AND "deletedAt" IS NULL AND "parentId" IS NULL
    ORDER BY "createdAt" ASC LIMIT 1`;
  return rows.length > 0 ? (rows[0] as Record<string, unknown>).id as string : null;
}

// Mirrors stockEngine.applyMovement for order lines: upsert level, move
// onHand, append the immutable ledger row. qty signed (negative = out).
async function moveStock(
  sql: Sql,
  companyId: string,
  productId: string,
  locationId: string,
  qty: number,
  type: string,
  reason: string,
  orderId: string,
  orderNumber: string,
  allowNegative: boolean
): Promise<void> {
  const prod = await sql`SELECT "trackStock" FROM products WHERE id = ${productId} AND "companyId" = ${companyId} LIMIT 1`;
  const trackStock = prod.length > 0 && (prod[0] as Record<string, unknown>).trackStock !== false;
  await sql`INSERT INTO stock_levels (id, "createdAt", "updatedAt", "companyId", "productId", "storageLocationId", "onHand", reserved)
    VALUES (${newId()}, now(), ${nowIso()}, ${companyId}, ${productId}, ${locationId}, 0, 0)
    ON CONFLICT ("productId", "storageLocationId") DO NOTHING`;
  const cur = await sql`SELECT id, "onHand" FROM stock_levels WHERE "productId" = ${productId} AND "storageLocationId" = ${locationId} LIMIT 1`;
  const current = Number((cur[0] as Record<string, unknown>).onHand);
  const next = current + qty;
  if (qty < 0 && next < 0 && !allowNegative && trackStock) {
    throw { status: 400, message: "insufficient stock (would go negative)" };
  }
  await sql`UPDATE stock_levels SET "onHand" = ${next}, "updatedAt" = ${nowIso()} WHERE id = ${(cur[0] as Record<string, unknown>).id as string}`;
  await sql`INSERT INTO inventory_transactions (id, "createdAt", "companyId", "productId", "storageLocationId",
      "transactionType", quantity, "balanceAfter", "unitCost", reason, "referenceType", "referenceId", "referenceNumber", "actorId")
    VALUES (${newId()}, now(), ${companyId}, ${productId}, ${locationId}, ${type}, ${qty}, ${next}, 0,
      ${reason}, 'Order', ${orderId}, ${orderNumber}, NULL)`;
}

async function commitOrderStock(
  sql: Sql,
  companyId: string,
  order: Record<string, unknown>,
  lines: { productId: string; quantity: number }[]
): Promise<void> {
  const settings = await companySettings(sql, companyId);
  if (settings.stockCommitPoint !== "CONFIRMATION") return;
  let warehouseId = order.warehouseId as string | null;
  if (!warehouseId) warehouseId = await defaultWarehouse(sql, companyId);
  if (!warehouseId) return;
  const locationId = await rootLocation(sql, companyId, warehouseId);
  if (!locationId) return;
  const isReturn = order.type === "RETURN";
  for (const l of lines) {
    const qty = Number(l.quantity);
    if (!(qty > 0)) continue;
    await moveStock(
      sql, companyId, l.productId, locationId,
      isReturn ? qty : -qty, isReturn ? "RETURN_IN" : "SALE",
      isReturn ? "إرجاع طلب" : "تأكيد طلب",
      order.id as string, order.orderNumber as string, settings.allowNegativeStock
    );
  }
}

async function releaseOrderStock(
  sql: Sql,
  companyId: string,
  order: Record<string, unknown>,
  lines: { productId: string; quantity: number }[]
): Promise<void> {
  if (!order.confirmedAt) return;
  const settings = await companySettings(sql, companyId);
  if (settings.stockCommitPoint !== "CONFIRMATION") return;
  let warehouseId = order.warehouseId as string | null;
  if (!warehouseId) warehouseId = await defaultWarehouse(sql, companyId);
  if (!warehouseId) return;
  const locationId = await rootLocation(sql, companyId, warehouseId);
  if (!locationId) return;
  const isReturn = order.type === "RETURN";
  for (const l of lines) {
    const qty = Number(l.quantity);
    if (!(qty > 0)) continue;
    await moveStock(
      sql, companyId, l.productId, locationId,
      isReturn ? -qty : qty, isReturn ? "SALE" : "RETURN_IN",
      "إلغاء/إرجاع طلب",
      order.id as string, order.orderNumber as string, true
    );
  }
}

const ORDER_COLS = `id, "orderNumber", type, status, "customerId", "shippingCost", "discountPercentage", "couponId", "couponCode", "orderPrice", "orderActualPrice", "currencyCode", "detailedAddress", notes, "hasShortage", "warehouseId", "carrierId", "orderSourceId", "paymentMethodId", "shippingGovernorateId", "cityId", "storeId", "externalId", "externalNumber", "originalOrderId", "cancelReasonId"`;

async function getOrder(sql: Sql, companyId: string, id: string): Promise<Record<string, unknown> | null> {
  const rows = await sql`SELECT ${sql.unsafe(ORDER_COLS)}, "confirmedAt"::text AS "confirmedText", "confirmedAt" FROM orders
    WHERE "companyId" = ${companyId} AND "deletedAt" IS NULL
      AND ("orderNumber" = ${id} OR "externalNumber" = ${id} OR "externalId" = ${id} OR id::text = ${id}) LIMIT 1`;
  return rows.length > 0 ? (rows[0] as Record<string, unknown>) : null;
}

post("/v1/orders", async (sql, companyId, _p, _u, ctx) => {
  try {
    const b = bodyOf(ctx);
    const customerId = reqStr(b.customerId);
    if (!customerId) throw { status: 400, message: "customerId required" };
    await mustExist(sql, companyId, "customers", customerId, "customerId");
    const type = b.type === "RETURN" || b.type === "EXCHANGE" ? (b.type as string) : "SALE";
    const discountPercentage = num(b.discountPercentage);
    if (discountPercentage < 0 || discountPercentage > 100) throw { status: 400, message: "discountPercentage must be 0..100" };
    const shippingCost = num(b.shippingCost);
    if (shippingCost < 0) throw { status: 400, message: "shippingCost must be >= 0" };
    const { lines, subtotal } = await priceLines(sql, companyId, b.items);
    const orderPrice = round2(subtotal + shippingCost);
    const baseActual = round2(Math.max(0, orderPrice - (orderPrice * discountPercentage) / 100));
    let couponId: string | null = null;
    let couponCode: string | null = null;
    let orderActualPrice = baseActual;
    const couponInput = str(b.couponCode);
    if (couponInput) {
      const check = await checkCoupon(sql, companyId, couponInput, baseActual);
      couponId = check.couponId;
      couponCode = couponInput.toUpperCase();
      orderActualPrice = round2(Math.max(0, baseActual - check.fixed));
    }
    const warehouseId = await mustExistOpt(sql, companyId, "warehouses", b.warehouseId, "warehouseId");
    const carrierId = await mustExistOpt(sql, companyId, "carriers", b.carrierId, "carrierId");
    const orderSourceId = await mustExistOpt(sql, companyId, "order_sources", b.orderSourceId, "orderSourceId");
    const paymentMethodId = await mustExistOpt(sql, companyId, "payment_methods", b.paymentMethodId, "paymentMethodId");
    const shippingGovernorateId = await mustExistOpt(sql, companyId, "governorates", b.shippingGovernorateId, "shippingGovernorateId");
    const cityId = await mustExistOpt(sql, companyId, "cities", b.cityId, "cityId");
    const orderNumber = await nextOrderNumber(sql, companyId);
    const id = newId();
    await sql`INSERT INTO orders (id, "createdAt", "updatedAt", "companyId", "orderNumber", type, status, "customerId",
        "shippingCost", "discountPercentage", "couponId", "couponCode", "orderPrice", "orderActualPrice", "currencyCode",
        "hasShortage", "warehouseId", "carrierId", "orderSourceId", "paymentMethodId", "shippingGovernorateId",
        "cityId", "detailedAddress", notes, "originalOrderId")
      VALUES (${id}, now(), ${nowIso()}, ${companyId}, ${orderNumber}, ${type}, 'NEW', ${customerId},
        ${shippingCost}, ${discountPercentage}, ${couponId}, ${couponCode}, ${orderPrice}, ${orderActualPrice}, 'EGP',
        false, ${warehouseId}, ${carrierId}, ${orderSourceId}, ${paymentMethodId}, ${shippingGovernorateId},
        ${cityId}, ${str(b.detailedAddress)}, ${str(b.notes)}, ${str(b.originalOrderId)})`;
    for (const l of lines) {
      await sql`INSERT INTO order_items (id, "createdAt", "updatedAt", "companyId", "orderId", "productId", quantity,
          "confirmedQuantity", "unitPrice", "unitCost", "itemDiscountPercentage", "itemDiscountAmount", "discountType", "needsManufacturing")
        VALUES (${newId()}, now(), ${nowIso()}, ${companyId}, ${id}, ${l.productId}, ${l.quantity}, ${l.quantity},
          ${l.unitPrice}, ${l.unitCost}, ${l.itemDiscountPercentage}, ${l.itemDiscountAmount}, ${l.discountType}, false)`;
    }
    if (couponId) {
      await sql`UPDATE coupons SET "redemptionCount" = "redemptionCount" + 1, "updatedAt" = ${nowIso()} WHERE id = ${couponId}`;
    }
    const rows = await sql`SELECT ${sql.unsafe(ORDER_COLS)} FROM orders WHERE id = ${id}`;
    return json({ ...rows[0], items: lines }, 201);
  } catch (e) {
    return fail(e);
  }
});

patch("/v1/orders/:id", async (sql, companyId, p, _u, ctx) => {
  try {
    const b = bodyOf(ctx);
    const order = await getOrder(sql, companyId, p.id);
    if (!order) return json({ error: "order not found" }, 404);
    if (order.status === "DELIVERED" || order.status === "CANCELLED") {
      return json({ error: "order can no longer be edited in its status" }, 409);
    }
    const sets: string[] = [];
    const vals: (string | number | boolean | null)[] = [];
    const set = (col: string, v: unknown) => {
      vals.push(v as string | number | boolean | null);
      sets.push(`"${col}" = $${vals.length}`);
    };
    let lines: PricedLine[] | null = null;
    let subtotal = 0;
    if (b.items !== undefined) {
      const priced = await priceLines(sql, companyId, b.items);
      lines = priced.lines;
      subtotal = priced.subtotal;
      await sql`DELETE FROM order_items WHERE "orderId" = ${order.id as string}`;
      for (const l of lines) {
        await sql`INSERT INTO order_items (id, "createdAt", "updatedAt", "companyId", "orderId", "productId", quantity,
            "confirmedQuantity", "unitPrice", "unitCost", "itemDiscountPercentage", "itemDiscountAmount", "discountType", "needsManufacturing")
          VALUES (${newId()}, now(), ${nowIso()}, ${companyId}, ${order.id as string}, ${l.productId}, ${l.quantity}, ${l.quantity},
            ${l.unitPrice}, ${l.unitCost}, ${l.itemDiscountPercentage}, ${l.itemDiscountAmount}, ${l.discountType}, false)`;
      }
    }
    const shippingCost = b.shippingCost !== undefined ? num(b.shippingCost) : Number(order.shippingCost);
    const discountPercentage = b.discountPercentage !== undefined ? num(b.discountPercentage) : Number(order.discountPercentage);
    if (shippingCost < 0) throw { status: 400, message: "shippingCost must be >= 0" };
    if (discountPercentage < 0 || discountPercentage > 100) throw { status: 400, message: "discountPercentage must be 0..100" };
    if (lines !== null || b.shippingCost !== undefined || b.discountPercentage !== undefined) {
      let items = lines;
      let sub = subtotal;
      if (items === null) {
        const cur = await sql`SELECT "productId", quantity, "unitPrice", "unitCost", "itemDiscountPercentage", "itemDiscountAmount", "discountType"
          FROM order_items WHERE "orderId" = ${order.id as string}`;
        const repriced = await priceLines(
          sql, companyId,
          (cur as Record<string, unknown>[]).map((r) => ({
            productId: r.productId, quantity: Number(r.quantity), unitPrice: Number(r.unitPrice),
            unitCost: Number(r.unitCost), itemDiscountPercentage: Number(r.itemDiscountPercentage),
            itemDiscountAmount: Number(r.itemDiscountAmount), discountType: r.discountType,
          }))
        );
        items = repriced.lines;
        sub = repriced.subtotal;
      }
      void items;
      const orderPrice = round2(sub + shippingCost);
      const orderActualPrice = round2(Math.max(0, orderPrice - (orderPrice * discountPercentage) / 100));
      set("shippingCost", shippingCost);
      set("discountPercentage", discountPercentage);
      set("orderPrice", orderPrice);
      set("orderActualPrice", orderActualPrice);
    }
    if (b.detailedAddress !== undefined) set("detailedAddress", str(b.detailedAddress));
    if (b.notes !== undefined) set("notes", str(b.notes));
    if (b.warehouseId !== undefined) set("warehouseId", await mustExistOpt(sql, companyId, "warehouses", b.warehouseId, "warehouseId"));
    if (b.carrierId !== undefined) set("carrierId", await mustExistOpt(sql, companyId, "carriers", b.carrierId, "carrierId"));
    if (b.orderSourceId !== undefined) set("orderSourceId", await mustExistOpt(sql, companyId, "order_sources", b.orderSourceId, "orderSourceId"));
    if (b.paymentMethodId !== undefined) set("paymentMethodId", await mustExistOpt(sql, companyId, "payment_methods", b.paymentMethodId, "paymentMethodId"));
    if (b.shippingGovernorateId !== undefined) set("shippingGovernorateId", await mustExistOpt(sql, companyId, "governorates", b.shippingGovernorateId, "shippingGovernorateId"));
    if (b.cityId !== undefined) set("cityId", await mustExistOpt(sql, companyId, "cities", b.cityId, "cityId"));
    if (sets.length > 0) {
      vals.push(nowIso());
      sets.push(`"updatedAt" = $${vals.length}`);
      await sql.unsafe(
        `UPDATE orders SET ${sets.join(", ")} WHERE id = $${vals.length + 1} AND "companyId" = $${vals.length + 2}`,
        [...vals, order.id as string, companyId]
      );
    }
    const rows = await sql`SELECT ${sql.unsafe(ORDER_COLS)} FROM orders WHERE id = ${order.id as string}`;
    return json(rows[0]);
  } catch (e) {
    return fail(e);
  }
});

async function applyStatus(
  sql: Sql, companyId: string, id: string, status: unknown, extra: Body
): Promise<Response> {
  if (typeof status !== "string" || !ORDER_STATUSES.includes(status)) {
    return json({ error: "invalid status" }, 400);
  }
  const order = await getOrder(sql, companyId, id);
  if (!order) return json({ error: "order not found" }, 404);
  if (order.status === status) return json({ error: "order is already in this status" }, 409);
  if (order.status === "CANCELLED") return json({ error: "CANCELLED is terminal" }, 409);
  if (order.status === "DELIVERED") return json({ error: "DELIVERED is terminal here — use the returns flow" }, 409);
  if (status === "CANCELLED" && !reqStr(extra.cancelReasonId)) {
    return json({ error: "cancelReasonId required to cancel" }, 400);
  }
  let warehouseId = order.warehouseId as string | null;
  if (status === "CONFIRMED") {
    const wid = reqStr(extra.warehouseId) ?? warehouseId;
    const trackers = await sql`SELECT oi.id FROM order_items oi JOIN products pr ON pr.id = oi."productId"
      WHERE oi."orderId" = ${order.id as string} AND pr."trackStock" = true LIMIT 1`;
    if (trackers.length > 0 && !wid) {
      return json({ error: "warehouseId required: order has tracked-stock lines" }, 400);
    }
    warehouseId = wid;
  }
  const stamps: Record<string, string> = {
    CONFIRMED: "confirmedAt",
    ON_THE_WAY: "shippedAt",
    DELIVERED: "deliveredAt",
    CANCELLED: "cancelledAt",
  };
  const stampCol = stamps[status];
  await sql.unsafe(
    `UPDATE orders SET status = $1, "cancelReasonId" = $2, ${stampCol ? `"${stampCol}" = now(), ` : ""}"warehouseId" = $3, "updatedAt" = $4 WHERE id = $5`,
    [status, status === "CANCELLED" ? reqStr(extra.cancelReasonId) : (order.cancelReasonId as string | null), warehouseId, nowIso(), order.id as string]
  );
  const itemRows = await sql`SELECT "productId", quantity, "confirmedQuantity" FROM order_items WHERE "orderId" = ${order.id as string}`;
  const lines = (itemRows as Record<string, unknown>[]).map((r) => ({
    productId: r.productId as string,
    quantity: Number(r.confirmedQuantity ?? r.quantity),
  }));
  const withWarehouse = { ...(order as object), warehouseId } as Record<string, unknown>;
  if (status === "CONFIRMED") await commitOrderStock(sql, companyId, withWarehouse, lines);
  if (status === "CANCELLED" || status === "RETURNED" || status === "RETURNED_TO_WAREHOUSE") {
    await releaseOrderStock(sql, companyId, withWarehouse, lines);
  }
  const rows = await sql`SELECT ${sql.unsafe(ORDER_COLS)} FROM orders WHERE id = ${order.id as string}`;
  return json(rows[0]);
}

post("/v1/orders/:id/status", async (sql, companyId, p, _u, ctx) => {
  try {
    return await applyStatus(sql, companyId, p.id, bodyOf(ctx).status, bodyOf(ctx));
  } catch (e) {
    return fail(e);
  }
});

post("/v1/orders/:id/cancel", async (sql, companyId, p, _u, ctx) => {
  try {
    return await applyStatus(sql, companyId, p.id, "CANCELLED", bodyOf(ctx));
  } catch (e) {
    return fail(e);
  }
});

del("/v1/orders/:id", async (sql, companyId, p) => {
  const order = await getOrder(sql, companyId, p.id);
  if (!order) return json({ error: "order not found" }, 404);
  if (order.status === "DELIVERED") return json({ error: "delivered orders cannot be deleted" }, 409);
  // No stock reversal on delete: cancel first to restock, same as the dashboard.
  await sql`UPDATE orders SET "deletedAt" = now(), "updatedAt" = ${nowIso()} WHERE id = ${order.id as string}`;
  return json({ deleted: true, id: order.id });
});

// ── stock adjust ────────────────────────────────────────────────────────────
post("/v1/stock/adjust", async (sql, companyId, _p, _u, ctx) => {
  try {
    const b = bodyOf(ctx);
    const productId = reqStr(b.productId);
    const locationId = reqStr(b.storageLocationId);
    const counted = num(b.countedQuantity, NaN);
    if (!productId) throw { status: 400, message: "productId required" };
    if (!locationId) throw { status: 400, message: "storageLocationId required" };
    if (!Number.isFinite(counted) || counted < 0) throw { status: 400, message: "countedQuantity must be >= 0" };
    const prod = await sql`SELECT id, "trackStock" FROM products WHERE "companyId" = ${companyId} AND id = ${productId} AND "deletedAt" IS NULL LIMIT 1`;
    if (prod.length === 0) return json({ error: "product not found" }, 404);
    const loc = await sql`SELECT id FROM storage_locations WHERE "companyId" = ${companyId} AND id = ${locationId} AND "deletedAt" IS NULL LIMIT 1`;
    if (loc.length === 0) return json({ error: "storage location not found" }, 404);
    const lvl = await sql`SELECT id, "onHand" FROM stock_levels WHERE "productId" = ${productId} AND "storageLocationId" = ${locationId} LIMIT 1`;
    const current = lvl.length > 0 ? Number((lvl[0] as Record<string, unknown>).onHand) : 0;
    const delta = round2(counted - current);
    if (delta === 0) return json({ productId, previous: current, balanceAfter: current, adjusted: false });
    const settings = await companySettings(sql, companyId);
    const trackStock = (prod[0] as Record<string, unknown>).trackStock !== false;
    if (delta < 0 && current + delta < 0 && !settings.allowNegativeStock && trackStock) {
      return json({ error: "insufficient stock (would go negative)" }, 400);
    }
    const reason = reqStr(b.reason) ?? "تسوية عبر AI API";
    await sql`INSERT INTO stock_levels (id, "createdAt", "updatedAt", "companyId", "productId", "storageLocationId", "onHand", reserved)
      VALUES (${newId()}, now(), ${nowIso()}, ${companyId}, ${productId}, ${locationId}, 0, 0)
      ON CONFLICT ("productId", "storageLocationId") DO NOTHING`;
    const next = round2(current + delta);
    await sql`UPDATE stock_levels SET "onHand" = ${next}, "updatedAt" = ${nowIso()}
      WHERE "productId" = ${productId} AND "storageLocationId" = ${locationId}`;
    await sql`INSERT INTO inventory_transactions (id, "createdAt", "companyId", "productId", "storageLocationId",
        "transactionType", quantity, "balanceAfter", "unitCost", reason, "referenceType", "referenceId", "referenceNumber", "actorId")
      VALUES (${newId()}, now(), ${companyId}, ${productId}, ${locationId}, ${delta > 0 ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT"},
        ${delta}, ${next}, 0, ${reason}, NULL, NULL, NULL, NULL)`;
    return json({ productId, previous: current, balanceAfter: next, adjusted: true });
  } catch (e) {
    return fail(e);
  }
});

// ── notifications (company-wide rows only: API keys carry no user) ──────────
post("/v1/notifications/:id/read", async (sql, companyId, p) => {
  const cur = await sql`UPDATE notifications SET "isRead" = true, "readAt" = now()
    WHERE id = ${p.id} AND "companyId" = ${companyId} AND "userId" IS NULL RETURNING id`;
  if (cur.length === 0) return json({ error: "notification not found" }, 404);
  return json({ read: true, id: p.id });
});

post("/v1/notifications/read-all", async (sql, companyId) => {
  const cur = await sql`UPDATE notifications SET "isRead" = true, "readAt" = now()
    WHERE "companyId" = ${companyId} AND "userId" IS NULL AND "isRead" = false RETURNING id`;
  return json({ updated: cur.length });
});

del("/v1/notifications/:id", async (sql, companyId, p) => {
  const cur = await sql`DELETE FROM notifications WHERE id = ${p.id} AND "companyId" = ${companyId} AND "userId" IS NULL RETURNING id`;
  if (cur.length === 0) return json({ error: "notification not found" }, 404);
  return json({ deleted: true, id: p.id });
});

export { writeRoutes };
