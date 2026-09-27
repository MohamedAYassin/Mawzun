import {
  ChartBarIcon,
  ShoppingCartIcon,
  BookOpenIcon,
  BoxIcon,
  CheckCircleIcon,
  TruckIcon,
  SettingsIcon,
  UsersIcon,
  IdCardIcon,
  LayoutGridIcon,
  GlobeIcon,
  HomeIcon,
  TagIcon,
  LayersIcon,
  ActivityIcon,
  MapPinIcon,
  MapIcon,
  CreditCardIcon,
  PlusIcon,
  ScanBarcodeIcon,
} from "./SidebarIcons";

export interface NavItem {
  path: string;
  label: string;
  hint?: string;
  icon?: React.ReactNode;
}

export interface NavModule {
  id: string;
  label: string;
  icon: React.ReactNode;
  items: NavItem[];
  /**
   * The permission that gates the whole module. A user without it never sees
   * the entry (the backend enforces the same check on every request, so this
   * is presentation only). Modules without a gate are always shown.
   */
  permission?: string;
}

/**
 * Single source of truth for dashboard navigation.
 * The sidebar renders modules, the module tab bar renders the items of the
 * active module, and the command palette searches across everything.
 */
export const navModules: NavModule[] = [
  {
    id: "home",
    label: "لوحة التحكم",
    icon: <HomeIcon size={18} />,
    items: [
      {
        path: "/dashboard/sales-overview",
        label: "قيادة المبيعات",
        icon: <ChartBarIcon size={16} />,
      },
      { path: "/dashboard/inventory-overview", label: "قيادة المخزون", icon: <BoxIcon size={16} /> },
      {
        path: "/dashboard/accounting-overview",
        label: "ملخص المحاسبة",
        icon: <BookOpenIcon size={16} />,
      },
      { path: "/dashboard/reports", label: "التقارير", icon: <ActivityIcon size={16} /> },
    ],
  },
  {
    id: "sales",
    label: "المبيعات",
    icon: <ShoppingCartIcon size={18} />,
    items: [
      { path: "/dashboard/add-sale", label: "إضافة مبيعات", icon: <PlusIcon size={16} /> },
      { path: "/dashboard/orders", label: "سجل الطلبات", icon: <ShoppingCartIcon size={16} /> },
      {
        path: "/dashboard/confirmation-overview",
        label: "تأكيد الطلبات",
        icon: <CheckCircleIcon size={16} />,
      },
      { path: "/dashboard/customers", label: "العملاء", icon: <UsersIcon size={16} /> },
      { path: "/dashboard/coupons", label: "رموز الخصم", icon: <GlobeIcon size={16} /> },
      { path: "/dashboard/order-sources", label: "مصادر الطلبات", icon: <GlobeIcon size={16} /> },
      {
        path: "/dashboard/orders-transactions",
        label: "حركات البيع",
        icon: <BookOpenIcon size={16} />,
      },
    ],
  },
  {
    id: "inventory",
    label: "المخزون",
    icon: <BoxIcon size={18} />,
    items: [
      { path: "/dashboard/products", label: "المنتجات", icon: <TagIcon size={16} /> },
      { path: "/dashboard/add-product", label: "إضافة منتج", icon: <PlusIcon size={16} /> },
      {
        path: "/dashboard/product-family",
        label: "الخصائص والمتغيرات",
        icon: <LayersIcon size={16} />,
      },
      {
        path: "/dashboard/product-stocks",
        label: "أرصدة المنتجات",
        icon: <ChartBarIcon size={16} />,
      },
      {
        path: "/dashboard/inventory-transactions",
        label: "حركات التخزين",
        icon: <ActivityIcon size={16} />,
      },
      {
        path: "/dashboard/add-inventory-transaction",
        label: "تسجيل حركة",
        icon: <PlusIcon size={16} />,
      },
      { path: "/dashboard/warehouses", label: "المخازن", icon: <BoxIcon size={16} /> },
      {
        path: "/dashboard/storage-locations",
        label: "مواقع التخزين",
        icon: <MapPinIcon size={16} />,
      },
      {
        path: "/dashboard/inventory-adjustment",
        label: "الجرد الفعلي",
        icon: <LayersIcon size={16} />,
      },
      {
        path: "/dashboard/inventory-transfers",
        label: "تحويلات المخزون",
        icon: <MapIcon size={16} />,
      },
      {
        path: "/dashboard/stock-counts",
        label: "جرد المخزون",
        icon: <ScanBarcodeIcon size={16} />,
      },
      { path: "/dashboard/alerts", label: "تنبيهات المخزون", icon: <ActivityIcon size={16} /> },
    ],
  },
  {
    id: "purchasing",
    label: "المشتريات",
    permission: "Permissions.ViewVendors",
    icon: <IdCardIcon size={18} />,
    items: [
      {
        path: "/dashboard/purchase-orders",
        label: "أوامر الشراء",
        icon: <ShoppingCartIcon size={16} />,
      },
      { path: "/dashboard/vendors", label: "الموردون", icon: <UsersIcon size={16} /> },
      {
        path: "/dashboard/consignment-vendors",
        label: "موردو الأمانة",
        icon: <UsersIcon size={16} />,
      },
      {
        path: "/dashboard/supplier-overview",
        label: "ملخص الموردين",
        icon: <ChartBarIcon size={16} />,
      },
      { path: "/dashboard/stock-operations", label: "حركات المخزون", icon: <BoxIcon size={16} /> },
      {
        path: "/dashboard/purchase-transactions",
        label: "حركات الشراء",
        icon: <BookOpenIcon size={16} />,
      },
    ],
  },
  {
    id: "fulfillment",
    label: "التجهيز والشحن",
    icon: <TruckIcon size={18} />,
    items: [
      {
        path: "/dashboard/fulfillment-lists",
        label: "قوائم التجهيز والتغليف",
        icon: <LayoutGridIcon size={16} />,
      },
      { path: "/dashboard/production", label: "الباتشات", icon: <LayersIcon size={16} /> },
      { path: "/dashboard/add-batch", label: "إنشاء باتش", icon: <PlusIcon size={16} /> },
      { path: "/dashboard/scanning", label: "المسح الضوئي", icon: <ScanBarcodeIcon size={16} /> },
      {
        path: "/dashboard/scanner-transactions",
        label: "سجل المسح",
        icon: <ActivityIcon size={16} />,
      },
      {
        path: "/dashboard/shipping-overview",
        label: "عمليات الشحن",
        icon: <TruckIcon size={16} />,
      },
      {
        path: "/dashboard/shipping-companies",
        label: "شركات الشحن",
        icon: <TruckIcon size={16} />,
      },
      {
        path: "/dashboard/returns",
        label: "المرتجعات والاستبدال",
        icon: <ActivityIcon size={16} />,
      },
    ],
  },
  {
    id: "directory",
    label: "البيانات الأساسية",
    icon: <LayoutGridIcon size={18} />,
    items: [
      {
        path: "/dashboard/directory",
        label: "البيانات المرجعية",
        icon: <LayoutGridIcon size={16} />,
      },
      { path: "/dashboard/stores", label: "المتاجر المربوطة", icon: <GlobeIcon size={16} /> },
      {
        path: "/dashboard/payment-methods",
        label: "طرق الدفع",
        icon: <CreditCardIcon size={16} />,
      },
    ],
  },
  {
    id: "apps",
    label: "الإضافات",
    permission: "Permissions.ViewStores",
    icon: <LayoutGridIcon size={18} />,
    items: [
      { path: "/dashboard/apps", label: "الإضافات والربط", icon: <LayoutGridIcon size={16} /> },
    ],
  },
  {
    id: "settings",
    label: "الإعدادات",
    permission: "Permissions.ManageSettings",
    icon: <SettingsIcon size={18} />,
    items: [
      { path: "/system-settings", label: "إعدادات النظام", icon: <SettingsIcon size={16} /> },
      { path: "/users", label: "المستخدمون", icon: <UsersIcon size={16} /> },
      { path: "/access", label: "الأدوار والصلاحيات", icon: <IdCardIcon size={16} /> },
      { path: "/dashboard/api-keys", label: "المفاتيح البرمجية", icon: <IdCardIcon size={16} /> },
      {
        path: "/dashboard/integrations",
        label: "شركات الشحن",
        icon: <GlobeIcon size={16} />,
      },
      { path: "/dashboard/sync-errors", label: "أخطاء المزامنة", icon: <ActivityIcon size={16} /> },
      { path: "/change-password", label: "تغيير كلمة المرور", icon: <SettingsIcon size={16} /> },
    ],
  },
];

export function normalizePath(path: string): string {
  const lower = path.toLowerCase();
  return lower.length > 1 && lower.endsWith("/") ? lower.slice(0, -1) : lower;
}

/** Resolve the module + item that matches the current location. */
export function resolveActive(pathname: string): {
  module: NavModule | null;
  item: NavItem | null;
} {
  const current = normalizePath(pathname);
  const alias = current === "/dashboard" ? "/dashboard/sales-overview" : current;

  for (const mod of navModules) {
    for (const item of mod.items) {
      if (alias === item.path || alias.startsWith(`${item.path}/`)) {
        return { module: mod, item };
      }
    }
  }

  // Fall back to prefix matching so detail pages still land in a module.
  for (const mod of navModules) {
    for (const item of mod.items) {
      if (alias.startsWith(item.path)) return { module: mod, item };
    }
  }

  return { module: null, item: null };
}

export const allNavItems: (NavItem & { moduleLabel: string })[] = navModules.flatMap((mod) =>
  mod.items.map((item) => ({ ...item, moduleLabel: mod.label })),
);

export interface PageTab {
  key: string;
  label: string;
}

/**
 * Merged screens: one destination, several tabs. The tab lives in the
 * `tab` query string so every old deep link keeps working via redirects.
 */
export const pageTabGroups: Record<string, PageTab[]> = {
  "/dashboard/alerts": [
    { key: "low-stock", label: "تنبيهات النقص" },
    { key: "deficits", label: "عجز المخزون" },
  ],
  "/dashboard/fulfillment-lists": [
    { key: "picking", label: "سلال السحب" },
    { key: "packing", label: "صناديق التغليف" },
  ],
  "/dashboard/returns": [
    { key: "shipments", label: "استلام المرتجعات" },
    { key: "requests", label: "طلبات الإرجاع" },
    { key: "exchanges", label: "طلبات الاستبدال" },
  ],
  "/dashboard/directory": [
    { key: "brands", label: "الماركات" },
    { key: "categories", label: "الأقسام" },
    { key: "uom", label: "وحدات القياس" },
    { key: "reasons", label: "الأسباب" },
    { key: "governorates", label: "المحافظات" },
    { key: "cities", label: "المدن" },
  ],
  "/access": [
    { key: "roles", label: "الأدوار" },
    { key: "permissions", label: "الصلاحيات" },
  ],
};

/** Old single-purpose paths kept alive, pointing at the merged screens. */
export const mergedRedirects: Record<string, string> = {
  "/dashboard/low-stock": "/dashboard/alerts?tab=low-stock",
  "/dashboard/deficits-alert": "/dashboard/alerts?tab=deficits",
  "/dashboard/picking-list": "/dashboard/fulfillment-lists?tab=picking",
  "/dashboard/packing-list": "/dashboard/fulfillment-lists?tab=packing",
  "/dashboard/shipping-returns": "/dashboard/returns?tab=shipments",
  "/dashboard/brands": "/dashboard/directory?tab=brands",
  "/dashboard/categories": "/dashboard/directory?tab=categories",
  "/dashboard/uom": "/dashboard/directory?tab=uom",
  "/dashboard/reasons": "/dashboard/directory?tab=reasons",
  "/dashboard/governorates": "/dashboard/directory?tab=governorates",
  "/dashboard/cities": "/dashboard/directory?tab=cities",
  "/roles": "/access?tab=roles",
  "/permissions": "/access?tab=permissions",
};

/**
 * Splits one of the merged-destination targets above into the two things the
 * router wants separately: a route path and its search params.
 *
 * The router treats `to` as a route path rather than a URL, so a query string
 * glued onto it would be matched literally and land on the not-found route.
 */
export function mergedRedirectTarget(from: string): { to: string; search: Record<string, string> } {
  const target = mergedRedirects[from] ?? "/dashboard/sales-overview";
  const [to, query] = target.split("?");
  return { to: to || "/", search: Object.fromEntries(new URLSearchParams(query ?? "")) };
}
