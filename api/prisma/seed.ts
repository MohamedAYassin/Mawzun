import "dotenv/config";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Prisma } from "../src/generated/prisma/client.js";
import { Permissions } from "../src/constants/permissions.js";

// ---------------------------------------------------------------------------
// Mawzun seed.
//
// The deployment runs "prisma db seed" on every boot (package.json#start), so
// the entry point is guarded: without SEED_DEMO_DATA it only makes sure the
// platform-level reference rows exist (currently a no-op hook), which are not
// company data. That path is idempotent and never touches company rows.
//
// SEED_DEMO_DATA=true additionally fills the demo company "شركة النور للتجارة"
// (owner@mawzun.local / Owner@123 and staff1..4@mawzun.local / Staff@123) with
// Arabic sample data: catalog, stock, 120 orders with returns, production,
// inventory movements, carriers, ledger and notifications.
//
// Reruns are safe: fixed rows are found by unique keys and reused, and the
// random sample phase is skipped entirely once the company has orders, so a
// second run can never duplicate what the first one created.
// ---------------------------------------------------------------------------

const DEMO_COMPANY_NAME = "شركة النور للتجارة";

// Deterministic PRNG: every run builds the same shapes of data.
let seedState = 987654321;
function rand(): number { seedState = (seedState * 1103515245 + 12345) % 2147483648; return seedState / 2147483648; }
function randInt(min: number, max: number): number { return min + Math.floor(rand() * (max - min + 1)); }
function pick<T>(items: readonly T[]): T { return items[randInt(0, items.length - 1)]; }
function chance(p: number): boolean { return rand() < p; }
function daysAgo(days: number, hour = 10): Date { const d = new Date(); d.setDate(d.getDate() - days); d.setHours(hour, randInt(0, 59), randInt(0, 59), 0); return d; }
function money(min: number, max: number): number { return Math.round((min + rand() * (max - min)) * 100) / 100; }

// The privileged URL: seeding runs outside row-level security by design,
// because it creates the company every other row will belong to.
const directUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
if (!directUrl) throw new Error("DIRECT_DATABASE_URL is required for seeding");

/**
 * Remote hosts (Heroku Postgres, anything managed) require TLS; local
 * development postgres does not. Reading the host instead of hard-coding a
 * provider keeps this honest: the credential is whatever the URL says.
 */
function pgSsl(connectionString: string) {
  const host = new URL(connectionString).hostname;
  if (["localhost", "127.0.0.1", "::1"].includes(host)) return undefined;
  return { rejectUnauthorized: false };
}

const db = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: directUrl,
    ssl: pgSsl(directUrl),
  }),
});

/**
 * Runs fn inside a transaction carrying company context.
 *
 * Company rows are stamped with an explicit companyId anyway; the GUC makes
 * the transaction self-describing and matches how the request path scopes
 * everything. set_config(..., true) keeps it transaction-local, so pooled
 * connections cannot leak context between statements.
 */
async function withCompany<T>(companyId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return db.$transaction(
    async (tx: Prisma.TransactionClient) => {
      await tx.$executeRaw`SELECT set_config('app.company_id', ${companyId}, true)`;
      await tx.$executeRaw`SELECT set_config('app.is_platform_admin', 'false', true)`;
      return fn(tx);
    },
    { timeout: 180_000, maxWait: 30_000 }
  );
}

/** Platform tables have no company column; no GUC needed. */
async function withPlatform<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return db.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$executeRaw`SELECT set_config('app.is_platform_admin', 'true', true)`;
    return fn(tx);
  });
}

/**
 * The demo dataset lands in one transaction: every seeder shares a single tx,
 * so a failure anywhere rolls back the whole run. That is what makes reruns
 * safe after a partial failure — the previous run either committed entirely
 * or left nothing behind.
 */
async function withDemoTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return db.$transaction(
    async (tx: Prisma.TransactionClient) => fn(tx),
    { timeout: 180_000, maxWait: 30_000 }
  );
}

/** Platform-level seeding hook. Currently a no-op: the platform rows the UI
 * used to depend on were removed with the billing/wallet feature. Kept so the
 * seed driver below does not change shape. */
async function ensurePlatformPlans(): Promise<void> {
  return;
}

/**
 * Roles for the demo company. The owner holds every permission implicitly
 * (resolvePermissions keys off companies.owner_id); staff get the read-mostly
 * set so the Staff login demonstrates role-based access.
 */
async function ensureStaffRole(companyId: string): Promise<{ roleId: string }> {
  return withCompany(companyId, async (tx) => {
    const staffKeys = [
      Permissions.ViewProducts,
      Permissions.ViewCategories,
      Permissions.ViewBrands,
      Permissions.ViewUoms,
      Permissions.ViewWarehouses,
      Permissions.ViewStorageLocations,
      Permissions.ViewInventory,
      Permissions.ViewStockOperations,
      Permissions.ViewOrders,
      Permissions.ViewCustomers,
      Permissions.ViewFulfillment,
      Permissions.ViewShippingReturns,
    ];
    let role = await tx.role.findFirst({ where: { companyId, name: "Staff" } });
    if (!role) {
      role = await tx.role.create({ data: { companyId, name: "Staff", kind: "STAFF", isSystem: true } });
    }
    const existing = await tx.rolePermission.findMany({ where: { roleId: role.id } });
    const have = new Set(existing.map((rp: { permissionKey: string }) => rp.permissionKey));
    for (const key of staffKeys) {
      if (!have.has(key)) {
        await tx.rolePermission.create({ data: { roleId: role.id, permissionKey: key } });
      }
    }
    return { roleId: role.id };
  });
}

/** The demo company, its owner, and four staff logins. Idempotent by email. */
async function ensureDemoCompany(): Promise<{ companyId: string; ownerId: string; staffIds: string[] }> {
  const ownerHash = await bcrypt.hash("Owner@123", 10);
  const staffHash = await bcrypt.hash("Staff@123", 10);

  // The owner has to exist first: companies.owner_id is a unique foreign key
  // to users, so the company row points at an existing user.
  const existingOwner = await db.user.findUnique({ where: { email: "owner@mawzun.local" } });
  let company = await db.company.findFirst({ where: { name: DEMO_COMPANY_NAME } });

  // Owner + company + attachment must land in one commit: the deferred
  // COMPANY_MEMBERSHIP_REQUIRED trigger only ever sees the final state.
  let owner = existingOwner;
  if (!company) {
    let slug = "alnoor-trading";
    if (await db.company.findUnique({ where: { slug } })) {
      slug = "alnoor-trading-" + crypto.randomBytes(2).toString("hex");
    }
    const created = await db.$transaction(async (tx: Prisma.TransactionClient) => {
      const o =
        owner ??
        (await tx.user.create({
          data: {
            email: "owner@mawzun.local",
            fullName: "مالك الحساب",
            passwordHash: ownerHash,
            securityStamp: crypto.randomUUID(),
          },
        }));
      const c = await tx.company.create({
        data: {
          name: DEMO_COMPANY_NAME,
          slug,
          email: "owner@mawzun.local",
          currencyCode: "EGP",
          status: "ACTIVE",
          ownerId: o.id,
        },
      });
      await tx.user.update({ where: { id: o.id }, data: { companyId: c.id } });
      return { owner: o, company: c };
    });
    owner = created.owner;
    company = created.company;
  } else if (owner && owner.companyId !== company.id) {
    await db.user.update({ where: { id: owner.id }, data: { companyId: company.id } });
  } else if (!owner) {
    // Company exists but its owner row does not (a partial prior seed):
    // create the owner already attached to the company.
    owner = await db.user.create({
      data: {
        email: "owner@mawzun.local",
        fullName: "مالك الحساب",
        passwordHash: ownerHash,
        securityStamp: crypto.randomUUID(),
        companyId: company.id,
      },
    });
  }

  const { roleId } = await ensureStaffRole(company.id);

  const staffNames = ["أحمد محمد", "سارة عبدالله", "محمد السيد", "فاطمة خالد"];
  const staffIds: string[] = [];
  for (let i = 0; i < staffNames.length; i++) {
    const email = "staff" + (i + 1) + "@mawzun.local";
    const existing = await db.user.findUnique({ where: { email } });
    const user = existing ?? (await db.user.create({
      data: { email, fullName: staffNames[i], passwordHash: staffHash, securityStamp: crypto.randomUUID(), companyId: company.id },
    }));
    const link = await db.userRole.findUnique({ where: { userId_roleId: { userId: user.id, roleId } } });
    if (!link) {
      await db.userRole.create({ data: { userId: user.id, roleId } });
    }
    staffIds.push(user.id);
  }

  return { companyId: company.id, ownerId: owner.id, staffIds };
}

/** Lookups, warehouses, locations and geography for the demo company. */
async function seedLookups(companyId: string, tx: Prisma.TransactionClient): Promise<{
  brands: { id: string }[];
  categories: { id: string }[];
  warehouses: { id: string }[];
  storageLocations: { id: string }[];
  operationTypes: { id: string; sequencePrefix: string }[];
  cities: { id: string; name: string; governorateId: string }[];
}> {
  {
    await tx.taxRate.create({ data: { companyId, name: "ضريبة القيمة المضافة", percentage: 14 } });
    await tx.taxRate.create({ data: { companyId, name: "معفى", percentage: 0 } });

    const brands: { id: string }[] = [];
    for (const name of ["نور", "المصرية للمواد", "تكنوبلس", "أفق الجديد", "ورشة الجودة"]) {
      brands.push(await tx.brand.create({ data: { companyId, name, isActive: true, description: "ماركة مسجلة في النظام" } }));
    }

    const categories: { id: string }[] = [];
    for (const name of ["إلكترونيات", "ملابس", "منتجات عناية", "منتجات غذائية", "أدوات منزلية", "كتب"]) {
      categories.push(await tx.category.create({ data: { companyId, name, isActive: true } }));
    }

    const warehouseDefs: { name: string; code: string; address: string; phoneNumber: string }[] = [
      { name: "المستودع الرئيسي", code: "WH-MAIN", address: "القاهرة - المنطقة الصناعية", phoneNumber: "01000000001" },
      { name: "مستودع الإسكندرية", code: "WH-ALX", address: "الإسكندرية - المعمورة", phoneNumber: "01000000002" },
    ];
    const warehouses: { id: string; name: string; code: string | null }[] = [];
    for (const def of warehouseDefs) {
      warehouses.push(await tx.warehouse.create({ data: { companyId, name: def.name, code: def.code, address: def.address, countryCode: "EG", phoneNumber: def.phoneNumber, isActive: true, isDefault: warehouses.length === 0 } }));
    }

    const locationDefs: [string, string, number][] = [
      ["STOCK", "منطقة التخزين", 0],
      ["PICK", "منطقة الالتقاط", 0],
      ["RET", "منطقة المرتجعات", 0],
      ["ALX-STOCK", "تخزين إسكندرية", 1],
      ["ALX-PICK", "التقاط إسكندرية", 1],
    ];
    const storageLocations: { id: string }[] = [];
    for (const def of locationDefs) {
      const warehouse = warehouses[def[2]];
      storageLocations.push(await tx.storageLocation.create({
        data: { companyId, warehouseId: warehouse.id, name: warehouse.name + " - " + def[1], code: warehouse.code + "-" + def[0], isActive: true },
      }));
    }

    const governorateNames = ["القاهرة", "الجيزة", "الإسكندرية", "الدقهلية", "الشرقية", "المنوفية", "أسوان", "بورسعيد"];
    const governorates: { id: string }[] = [];
    for (const name of governorateNames) {
      governorates.push(await tx.governorate.create({ data: { companyId, name } }));
    }

    const citySpecs: [string, number][] = [
      ["مدينة نصر", 0], ["مصر الجديدة", 0], ["حلوان", 0],
      ["الدقي", 1], ["6 أكتوبر", 1], ["الهرم", 1],
      ["سموحة", 2], ["العجمي", 2],
      ["المنصورة", 3], ["ميت غمر", 3],
      ["الزقازيق", 4], ["بلبيس", 4],
      ["شبين الكوم", 5], ["منوف", 5],
      ["أسوان", 6], ["كوم أمبو", 6],
      ["بورسعيد", 7],
    ];
    const cities: { id: string; name: string; governorateId: string }[] = [];
    for (const spec of citySpecs) {
      cities.push(await tx.city.create({ data: { companyId, name: spec[0], governorateId: governorates[spec[1]].id } }));
    }

    for (const name of ["المتجر الإلكتروني", "فيسبوك", "إنستجرام", "هاتف", "واتساب"]) {
      await tx.orderSource.create({ data: { companyId, name } });
    }
    for (const name of ["الدفع عند الاستلام", "فيزا", "محفظة إلكترونية", "تحويل بنكي"]) {
      await tx.paymentMethod.create({ data: { companyId, name } });
    }
    for (const name of ["العميل غير متاح", "رفض الاستلام", "عنوان خاطئ", "تغيير الرأي", "لا يوجد رصيد"]) {
      await tx.cancelReason.create({ data: { companyId, name } });
    }

    const operationTypeDefs = [
      { name: "صرف مخزني", code: "PICK", requiresValidation: true, sequencePrefix: "PICK", reservationMethod: "AT_CONFIRMATION" as const },
      { name: "تجهيز طرد", code: "PACK", requiresValidation: true, sequencePrefix: "PACK", reservationMethod: "AT_CONFIRMATION" as const },
      { name: "تحويل خارجي", code: "TRANSIT_OUT", requiresValidation: false, sequencePrefix: "TRANSIT_OUT", reservationMethod: "MANUAL" as const },
      { name: "جرد داخلي", code: "INTERNAL", requiresValidation: false, sequencePrefix: "INTERNAL", reservationMethod: "MANUAL" as const },
      { name: "استلام مرتجع", code: "RETURN", requiresValidation: true, sequencePrefix: "RETURN", reservationMethod: "MANUAL" as const },
    ];
    const operationTypes: { id: string; sequencePrefix: string }[] = [];
    for (const def of operationTypeDefs) {
      operationTypes.push(await tx.operationType.create({ data: { companyId, ...def } }));
    }

    return { brands, categories, warehouses, storageLocations, operationTypes, cities };
  }
}

/** Product attributes: color values drive the variant matrix. */
async function seedAttributes(companyId: string, tx: Prisma.TransactionClient): Promise<{ colorValues: { id: string; value: string }[] }> {
  {
    const colorAttr = await tx.productAttribute.create({
      data: { companyId, name: "اللون", code: "COLOR", type: "COLOR", isActive: true },
    });
    const colorDefs: [string, string][] = [
      ["أسود", "#000000"],
      ["أبيض", "#FFFFFF"],
      ["أحمر", "#FF0000"],
      ["أزرق", "#0000FF"],
      ["أخضر", "#00FF00"],
    ];
    const colorValues: { id: string; value: string }[] = [];
    for (let i = 0; i < colorDefs.length; i++) {
      colorValues.push(await tx.productAttributeValue.create({
        data: { companyId, attributeId: colorAttr.id, value: colorDefs[i][0], colorHex: colorDefs[i][1], sortOrder: i, isActive: true },
      }));
    }
    const sizeAttr = await tx.productAttribute.create({
      data: { companyId, name: "المقاس", code: "SIZE", type: "SELECT", isActive: true },
    });
    const sizeNames = ["صغير", "متوسط", "كبير"];
    for (let i = 0; i < sizeNames.length; i++) {
      await tx.productAttributeValue.create({
        data: { companyId, attributeId: sizeAttr.id, value: sizeNames[i], sortOrder: i, isActive: true },
      });
    }
    return { colorValues };
  }
}

const PRODUCT_DEFS: [string, number, number, number, number, boolean][] = [
  ["هاتف ذكي نوا 5", 0, 0, 5500, 4200, true],
  ["حاسوب محمول ألماس 15", 0, 0, 22000, 17000, true],
  ["سماعات لاسلكية برو", 0, 0, 1200, 850, true],
  ["شاحن سريع 65 واط", 0, 0, 380, 250, false],
  ["ساعة ذكية رياضية", 0, 0, 2900, 2100, true],
  ["مكبر صوت محمول", 0, 0, 780, 520, false],
  ["لوحة مفاتيح ميكانيكية", 0, 0, 1450, 1050, false],
  ["ماوس لاسلكي صامت", 0, 0, 320, 210, false],
  ["قميص رجالي كلاسيك", 1, 1, 480, 310, true],
  ["تيشيرت قطن مريح", 1, 1, 240, 150, true],
  ["جينز مريح", 1, 1, 720, 500, true],
  ["عباية نسائية مطرزة", 1, 1, 980, 680, false],
  ["حجاب شيفون", 1, 1, 165, 95, true],
  ["حزام جلد طبيعي", 1, 1, 290, 185, false],
  ["حذاء رياضي خفيف", 1, 1, 850, 590, true],
  ["كريم ترطيب عميق", 2, 4, 220, 140, false],
  ["زيت الأرغان للشعر", 2, 4, 145, 88, false],
  ["صابون طبيعي بالطين", 2, 4, 65, 38, true],
  ["عطر رجالي فاخر", 2, 4, 720, 480, false],
  ["سيروم فيتامين سي", 2, 4, 390, 260, false],
  ["واقي شمس 50", 2, 4, 260, 170, false],
  ["عسل جبلي نقي", 3, 1, 265, 180, false],
  ["زيت زيتون بكر", 3, 1, 195, 130, true],
  ["مكسرات مشكلة فاخرة", 3, 1, 180, 115, false],
  ["شاي أخضر معطر", 3, 1, 85, 52, false],
  ["قهوة مطحونة فاخرة", 3, 1, 320, 220, false],
  ["توابل مشكلة", 3, 1, 55, 32, false],
  ["منظف أرضيات مركز", 4, 3, 195, 120, false],
  ["سلة مهملات مرنة", 4, 3, 240, 155, false],
  ["طقم أطباق 12 قطعة", 4, 3, 850, 590, true],
  ["مقلاة هوائية 5.5 لتر", 4, 3, 3600, 2700, false],
  ["غلاية ماء كهربائية", 4, 3, 780, 540, true],
  ["كتاب الطبخ المصري", 5, 3, 220, 140, false],
  ["رواية بوليسية", 5, 3, 140, 85, false],
  ["كتاب تنمية بشرية", 5, 3, 180, 110, false],
  ["دفتر ملاحظات فاخر", 5, 3, 95, 55, false],
  ["أقلام جاف ملونة", 5, 3, 65, 38, false],
  ["حقيبة ظهر عملية", 5, 3, 520, 350, true],
  ["محفظة جلد طبيعي", 5, 3, 380, 240, false],
  ["نظارة شمسية بولارايزد", 5, 3, 680, 450, true],
];
/** Products (with variants where flagged) and opening stock. */
async function seedCatalog(
  companyId: string,
  refs: {
    brands: { id: string }[];
    categories: { id: string }[];
    warehouses: { id: string }[];
    storageLocations: { id: string }[];
    colorValues: { id: string; value: string }[];
  },
  tx: Prisma.TransactionClient,
): Promise<{ products: { id: string; name: string; skuCode: string | null; price: number; costPrice: number }[] }> {
  {
    const products: { id: string; name: string; skuCode: string | null; price: number; costPrice: number }[] = [];
    let variantCount = 0;
    for (let i = 0; i < PRODUCT_DEFS.length; i++) {
      const def = PRODUCT_DEFS[i];
      const name = def[0];
      const price = def[3];
      const cost = def[4];
      const withVariants = def[5];
      const skuCode = "SKU-" + String(i + 1).padStart(3, "0");
      const product = await tx.product.create({
        data: {
          companyId,
          name,
          categoryId: refs.categories[def[1]].id,
          brandId: refs.brands[def[2]].id,
          description: "منتج مسجل في النظام - " + name,
          skuCode,
          barcode: "62" + String(2000000000 + i).padStart(10, "0"),
          price: price + money(0, 200),
          priceBeforeDiscount: price + money(200, 500),
          costPrice: cost,
          isActive: true,
        },
      });
      products.push({ id: product.id, name: product.name, skuCode: product.skuCode, price: Number(product.price), costPrice: Number(product.costPrice) });

      if (withVariants) {
        const variantColors = refs.colorValues.slice(0, randInt(2, refs.colorValues.length));
        for (const colorValue of variantColors) {
          await tx.productVariant.create({
            data: {
              companyId,
              productId: product.id,
              name: name + " - " + colorValue.value,
              skuCode: skuCode + "-" + colorValue.id.slice(-6),
              price: price + money(0, 150),
              costPrice: cost + money(0, 80),
              isActive: true,
              attributes: { create: [{ companyId, valueId: colorValue.id }] },
            },
          });
          variantCount++;
        }
      }
    }

    // Opening stock at each location, plus per-warehouse min/max levels.
    const stockRows: { productId: string; storageLocationId: string; onHand: number }[] = [];
    for (const product of products) {
      for (const location of refs.storageLocations) {
        if (!chance(0.65)) continue;
        stockRows.push({ productId: product.id, storageLocationId: location.id, onHand: randInt(0, 120) });
      }
    }
    for (const row of stockRows) {
      await tx.stockLevel.create({ data: { companyId, ...row } });
    }
    for (const product of products) {
      for (const warehouse of refs.warehouses) {
        await tx.reorderPoint.create({
          data: { companyId, productId: product.id, warehouseId: warehouse.id, minStockLevel: 10, maxStockLevel: 200 },
        });
      }
    }

    console.log("Catalog done (" + products.length + " products, " + variantCount + " variants, " + stockRows.length + " stock rows).");
    return { products };
  }
}

/** 120 sample orders (with returns) plus fulfillment batches. */
async function seedOrdersAndFulfillment(
  companyId: string,
  staffIds: string[],
  refs: {
    products: { id: string; name: string; skuCode: string | null; price: number; costPrice: number }[];
    warehouses: { id: string }[];
    cities: { id: string; name: string; governorateId: string }[];
  },
  tx: Prisma.TransactionClient,
): Promise<void> {
  {
    const carriers: { id: string }[] = await tx.carrier.findMany();
    const sources: { id: string }[] = await tx.orderSource.findMany();
    const methods: { id: string }[] = await tx.paymentMethod.findMany();
    const reasons: { id: string }[] = await tx.cancelReason.findMany();
    const cityNameById = new Map(refs.cities.map((c) => [c.id, c.name]));

    const statusWeights = [
      "NEW", "NEW", "NEW", "CONFIRMED", "CONFIRMED", "POSTPONED", "CANCELLED",
      "NO_ANSWER", "DELIVERED", "DELIVERED", "DELIVERED", "RETURNED", "NOT_DELIVERED",
      "ON_THE_WAY", "RETURNED_TO_WAREHOUSE",
    ] as const;
    type Status = (typeof statusWeights)[number];
    let orderCounter = 1000;
    for (let i = 0; i < 120; i++) {
      const createdAt = daysAgo(randInt(0, 89), randInt(9, 21));
      const city = pick(refs.cities);
      const itemCount = randInt(1, 4);
      const chosen: { id: string; price: number }[] = [];
      while (chosen.length < itemCount) {
        const candidate = pick(refs.products);
        if (!chosen.some((p) => p.id === candidate.id)) chosen.push(candidate);
      }
      const customer = await tx.customer.create({
        data: {
          companyId,
          name: "عميل-" + (i + 1),
          phoneNumber1: "01" + pick(["0", "1", "2", "5"]) + String(randInt(10000000, 99999999)),
          isActive: true,
        },
      });
      const itemsData = chosen.map((product) => {
        const quantity = randInt(1, 5);
        const unitPrice = product.price + money(0, 100);
        return { productId: product.id, quantity, unitPrice, confirmedQuantity: quantity, unitCost: 0, needsManufacturing: false };
      });
      const itemsTotal = itemsData.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
      const discountPercentage = chance(0.25) ? randInt(5, 20) : 0;
      const status = pick<Status>(statusWeights);
      const order = await tx.order.create({
        data: {
          companyId,
          orderNumber: "ORD-" + orderCounter++,
          type: "SALE",
          status,
          createdAt,
          updatedAt: createdAt,
          customerId: customer.id,
          carrierId: chance(0.85) ? pick(carriers).id : null,
          shippingGovernorateId: city.governorateId,
          cityId: city.id,
          shippingCost: money(30, 80),
          orderSourceId: pick(sources).id,
          paymentMethodId: chance(0.8) ? pick(methods).id : null,
          warehouseId: pick(refs.warehouses).id,
          detailedAddress: "عنوان تفصيلي - حي " + randInt(1, 20) + " - " + (cityNameById.get(city.id) ?? ""),
          notes: chance(0.2) ? "طلب عميل مميز - يرجى الاتصال قبل التوصيل" : null,
          hasShortage: chance(0.1),
          cancelReasonId: status === "CANCELLED" && chance(0.8) ? pick(reasons).id : null,
          discountPercentage,
          orderPrice: itemsTotal,
          orderActualPrice: Math.round(itemsTotal * (1 - discountPercentage / 100) * 100) / 100,
          createdById: pick(staffIds),
          items: { create: itemsData },
        },
      });
      void order;
    }
    console.log("Orders done (120).");
  }
}

/** A demo carrier list — the same names the old seeder used. */
async function seedCarriers(companyId: string, tx: Prisma.TransactionClient): Promise<void> {
  {
    const defs: [string, string, number, number, number, boolean][] = [
      ["بوسطة", "bosta", 65, 55, 30, true],
      ["أرامكس", "aramex", 75, 65, 40, false],
      ["جيم إكسبرس", "my-express", 70, 60, 35, false],
      ["ديليفيري سيه", "delivery-seha", 60, 50, 25, false],
    ];
    for (const def of defs) {
      await tx.carrier.create({
        data: {
          companyId,
          name: def[0],
          code: def[1],
          type: "INTEGRATED",
          isActive: true,
          defaultShippingCost: def[2],
          defaultCustomerShippingCost: def[3],
          returnShippingCost: def[4],
          autoSendOrderEnabled: def[5],
          settings: { apiKey: "seed-key" },
        },
      });
    }
  }
}

/** Global reference countries. Countries are not company data. */
async function seedCountries(): Promise<void> {
  await withPlatform(async (tx) => {
    const defs: [string, string, string, string][] = [
      ["EG", "Egypt", "مصر", "+20"],
      ["SA", "Saudi Arabia", "السعودية", "+966"],
      ["AE", "United Arab Emirates", "الإمارات", "+971"],
    ];
    for (const def of defs) {
      await tx.country.upsert({
        where: { code: def[0] },
        update: { nameEn: def[1], nameAr: def[2], phoneCode: def[3], isActive: true },
        create: { code: def[0], nameEn: def[1], nameAr: def[2], phoneCode: def[3], isActive: true },
      });
    }
  });
}

const NotificationCategoryMap = {
  GENERAL: "GENERAL",
  ORDER: "ORDER",
  INVENTORY: "INVENTORY",
  SYSTEM: "SYSTEM",
} as const;

/** Notifications for the demo company (a couple unread for the bell). */
async function seedNotifications(companyId: string, tx: Prisma.TransactionClient): Promise<void> {
  {
    const defs: [string, string, (typeof NotificationCategoryMap)[keyof typeof NotificationCategoryMap], string][] = [
      ["مخزون منخفض", "3 منتجات وصلت للحد الأدنى", "INVENTORY", "/dashboard/low-stock"],
      ["طلب جديد", "طلب جديد من المتجر الإلكتروني", "ORDER", "/dashboard/orders"],
      ["اكتمال دفعة", "تم إكمال دفعة الإنتاج PB-2026-001", "GENERAL", "/dashboard/production"],
      ["خطأ مزامنة", "فشل مزامنة طلب من متجر النور", "GENERAL", "/dashboard/sync-errors"],
    ];
    for (let i = 0; i < defs.length; i++) {
      const def = defs[i];
      await tx.notification.create({
        data: {
          companyId,
          createdAt: daysAgo(i),
          title: def[0],
          message: def[1],
          category: def[2],
          link: def[3],
          isRead: i > 1,
        },
      });
    }
    await tx.notification.create({
      data: {
        companyId,
        title: "مرحباً بك في موزون",
        message: "تم تجهيز مساحة العمل بالبيانات التجريبية الكاملة. استكشف الطلبات والمخازن والتقارير.",
        category: "GENERAL",
      },
    });
  }
}

async function main(): Promise<void> {
  console.log("== Mawzun seed ==");
  await ensurePlatformPlans();
  await seedCountries();
  console.log("Platform plans + countries ready.");

  if (process.env.SEED_DEMO_DATA !== "true") {
    console.log("SEED_DEMO_DATA not set; skipping demo company data.");
    console.log("== Seed complete ==");
    await db.$disconnect();
    return;
  }

  const ids = await withDemoTransaction(async (tx) => {
    const { companyId, ownerId, staffIds } = await ensureDemoCompany();
    const existingOrders = await tx.order.count({ where: { companyId } });
    if (existingOrders > 0) {
      console.log("Demo company already has data (" + existingOrders + " orders); skipping sample data.");
      return { companyId, ownerId };
    }
    // Scoped tables derive companyId from this GUC when a create does not
    // carry it explicitly (nested creates like order items).
    await tx.$executeRaw`SELECT set_config('app.company_id', ${companyId}, true)`;
    await tx.$executeRaw`SELECT set_config('app.is_platform_admin', 'false', true)`;
    const lookups = await seedLookups(companyId, tx);
    const { colorValues } = await seedAttributes(companyId, tx);
    await seedCarriers(companyId, tx);
    const { products } = await seedCatalog(companyId, {
      brands: lookups.brands,
      categories: lookups.categories,
      warehouses: lookups.warehouses,
      storageLocations: lookups.storageLocations,
      colorValues,
    }, tx);
    await seedOrdersAndFulfillment(companyId, staffIds, {
      products,
      warehouses: lookups.warehouses,
      cities: lookups.cities,
    }, tx);
    await seedNotifications(companyId, tx);
    return { companyId, ownerId };
  });

  console.log("Demo company ready.");
  console.log("Login: owner@mawzun.local / Owner@123  |  staff1@mawzun.local / Staff@123");
  console.log("CompanyId: " + ids.companyId);
  console.log("== Seed complete ==");
  await db.$disconnect();
}

void main();
