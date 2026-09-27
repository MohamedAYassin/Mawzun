import type { Db } from "../../config/database.js";
import { Permissions, getAllPermissions, type PermissionKey } from "../../constants/permissions.js";

// Everything a brand new company needs before its owner can do anything useful:
// the three roles that ship with every company, its typed settings row, and the
// reference data the order and stock screens expect to exist.
//
// Shared by signup and the seeder so the two can never drift apart. Signup runs
// it inside the same transaction that creates the company, which means a
// half-provisioned company is not a state that can exist.

/**
 * The owner holds every permission implicitly and is never checked against
 * these rows. They are still materialised so the role list in the UI is honest
 * about what the owner can do.
 */
const ADMIN_EXCLUDED: ReadonlySet<PermissionKey> = new Set<PermissionKey>([
  Permissions.ManageRoles,
  Permissions.ManageSettings,
  Permissions.ManageApiKeys,
]);

/** Operational staff: they run the business day to day, they do not configure it. */
const STAFF_PERMISSIONS: ReadonlySet<PermissionKey> = new Set<PermissionKey>([
  Permissions.ViewProducts,
  Permissions.ViewCategories,
  Permissions.ViewBrands,
  Permissions.ViewUoms,
  Permissions.ViewWarehouses,
  Permissions.ViewStorageLocations,
  Permissions.ViewInventory,
  Permissions.ViewStockOperations,
  Permissions.ManageStockOperations,
  Permissions.ViewOrders,
  Permissions.CreateOrder,
  Permissions.UpdateOrder,
  Permissions.ViewCustomers,
  Permissions.CreateCustomer,
  Permissions.UpdateCustomer,
  Permissions.ViewFulfillment,
  Permissions.ManageFulfillment,
  Permissions.ViewShippingReturns,
  Permissions.ViewVendors,
  Permissions.ViewPurchaseOrders,
  Permissions.ViewCarriers,
  Permissions.ViewProductionBatches,
  Permissions.ViewNotifications,
]);

export interface ProvisionCompanyInput {
  companyId: string;
  ownerUserId: string;
  /** Used for the default warehouse name and the welcome notification. */
  companyName: string;
}

export async function provisionCompany(
  tx: Db,
  { companyId, ownerUserId, companyName }: ProvisionCompanyInput
): Promise<void> {
  await seedRoles(tx, { companyId, ownerUserId });
  await seedSettings(tx, companyId);
  await seedReferenceData(tx, { companyId, companyName });
}

async function seedRoles(
  tx: Db,
  { companyId, ownerUserId }: { companyId: string; ownerUserId: string }
): Promise<void> {
  const all = getAllPermissions();

  const ownerRole = await tx.role.create({
    data: {
      companyId,
      name: "المالك",
      description: "المالك لديه كل الصلاحيات ولا يمكن حذفه.",
      kind: "OWNER",
      isSystem: true,
    },
  });

  const adminRole = await tx.role.create({
    data: {
      companyId,
      name: "مدير",
      description: "صلاحيات تشغيلية كاملة عدا إعدادات الشركة.",
      kind: "ADMIN",
      isSystem: true,
    },
  });

  const staffRole = await tx.role.create({
    data: {
      companyId,
      name: "موظف",
      description: "متابعة الطلبات والمخزون والعملاء.",
      kind: "STAFF",
      isSystem: true,
    },
  });

  await tx.rolePermission.createMany({
    data: [
      ...all.map((permissionKey) => ({ roleId: ownerRole.id, permissionKey })),
      ...all
        .filter((p) => !ADMIN_EXCLUDED.has(p as PermissionKey))
        .map((permissionKey) => ({ roleId: adminRole.id, permissionKey })),
      ...[...STAFF_PERMISSIONS].map((permissionKey) => ({
        roleId: staffRole.id,
        permissionKey,
      })),
    ],
  });

  await tx.userRole.create({
    data: { userId: ownerUserId, roleId: ownerRole.id },
  });
}

async function seedSettings(tx: Db, companyId: string): Promise<void> {
  await tx.companySettings.create({
    data: {
      companyId,
      invoicePrefix: "INV",
      purchaseOrderPrefix: "PO",
      orderPrefix: "ORD",
      defaultSalesVatRate: 0,
      defaultPurchaseVatRate: 0,
      stockCommitPoint: "CONFIRMATION",
      requireOrderConfirmation: true,
      allowManualDiscount: true,
      defaultOrderValidityHours: 48,
    },
  });
}

async function seedReferenceData(
  tx: Db,
  { companyId, companyName }: { companyId: string; companyName: string }
): Promise<void> {
  const warehouse = await tx.warehouse.create({
    data: {
      companyId,
      name: `مستودع ${companyName}`,
      code: "MAIN",
      isDefault: true,
      isActive: true,
    },
  });

  await tx.storageLocation.create({
    data: {
      companyId,
      warehouseId: warehouse.id,
      name: "الموقع الرئيسي",
      code: "MAIN-01",
      isActive: true,
    },
  });

  // The four movements every inventory module needs: goods arriving, goods
  // leaving, corrections, and internal transfers.
  await tx.operationType.createMany({
    data: [
      {
        companyId,
        name: "استلام بضاعة",
        code: "RECEIPT",
        description: "إدخال بضاعة من مورد إلى المستودع.",
        sequencePrefix: "REC",
        requiresValidation: false,
        reservationMethod: "MANUAL",
      },
      {
        companyId,
        name: "تسليم بضاعة",
        code: "DELIVERY",
        description: "إخراج بضاعة من المستودع لتنفيذ طلب.",
        sequencePrefix: "DEL",
        requiresValidation: true,
        reservationMethod: "AT_CONFIRMATION",
      },
      {
        companyId,
        name: "تسوية جرد",
        code: "ADJUSTMENT",
        description: "تعديل الكميات بعد الجرد الفعلي.",
        sequencePrefix: "ADJ",
        requiresValidation: true,
        reservationMethod: "MANUAL",
      },
      {
        companyId,
        name: "تحويل داخلي",
        code: "TRANSFER",
        description: "نقل بضاعة بين مستودعات الشركة.",
        sequencePrefix: "TRF",
        requiresValidation: false,
        reservationMethod: "MANUAL",
      },
    ],
  });

  await tx.orderSource.createMany({
    data: [
      { companyId, name: "المتجر الإلكتروني" },
      { companyId, name: "الهاتف" },
      { companyId, name: "واتساب" },
      { companyId, name: "فيسبوك" },
      { companyId, name: "إنستجرام" },
      { companyId, name: "زيارة ميدانية" },
    ],
  });

  await tx.paymentMethod.createMany({
    data: [
      { companyId, name: "الدفع عند الاستلام" },
      { companyId, name: "تحويل بنكي" },
      { companyId, name: "محفظة إلكترونية" },
      { companyId, name: "بطاقة ائتمان" },
    ],
  });

  await tx.cancelReason.createMany({
    data: [
      { companyId, name: "العميل غير الرغبة" },
      { companyId, name: "عدم الرد على الهاتف" },
      { companyId, name: "العنوان غير صحيح" },
      { companyId, name: "المنتج غير متوفر" },
      { companyId, name: "تأخر التوصيل" },
      { companyId, name: "السعر مرتفع" },
    ],
  });

  await tx.uom.createMany({
    data: [
      { companyId, code: "PCS", name: "قطعة", category: "quantity" },
      { companyId, code: "BOX", name: "صندوق", category: "quantity" },
      { companyId, code: "KG", name: "كيلوجرام", category: "weight" },
      { companyId, code: "G", name: "جرام", category: "weight" },
      { companyId, code: "L", name: "لتر", category: "volume" },
      { companyId, code: "M", name: "متر", category: "length" },
      { companyId, code: "SET", name: "طقم", category: "quantity" },
    ],
  });

  await tx.taxRate.create({
    data: {
      companyId,
      name: "السعر الأساسي",
      percentage: 0,
      isDefault: true,
      isActive: true,
    },
  });

  await tx.carrier.create({
    data: {
      companyId,
      name: "شحن يدوي",
      code: "MANUAL",
      type: "MANUAL",
      isActive: true,
      defaultShippingCost: 0,
      defaultCustomerShippingCost: 0,
      returnShippingCost: 0,
    },
  });

  await tx.notification.create({
    data: {
      companyId,
      title: `مرحباً بك في ${companyName}`,
      message:
        "تم تجهيز مساحة عمل شركتك. ابدأ بإضافة منتجاتك الأولى، ثم اربط مصادر الطلبات لتظهر الطلبات تلقائياً.",
      category: "GENERAL",
      // The dashboard prefix is required: the bell navigates this value
      // verbatim, and a bare "/products" matches no route.
      link: "/dashboard/products",
    },
  });
}
