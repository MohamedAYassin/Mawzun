import type { UpdateSettingsInput } from "../../lib/api";

// Section definitions for the company settings forms.
//
// Kept separate from the component so the module has a single responsibility
// and fast refresh is not disabled by mixing constants with a component.

export type SettingsFieldType = "text" | "number" | "bool" | "select";

export interface SettingsFieldDef<K extends keyof UpdateSettingsInput> {
  key: K;
  label: string;
  type: SettingsFieldType;
  options?: { value: string; label: string }[];
  placeholder?: string;
  hint?: string;
}

export interface SettingsSectionDef {
  id: string;
  title: string;
  description: string;
  fields: SettingsFieldDef<keyof UpdateSettingsInput>[];
}

const FISCAL_MONTHS = [
  { value: "1", label: "يناير" },
  { value: "4", label: "أبريل" },
  { value: "7", label: "يوليو" },
  { value: "10", label: "أكتوبر" },
];

const STOCK_COMMIT_POINTS = [
  { value: "CONFIRMATION", label: "بعد تأكيد الطلب" },
  { value: "FULFILLMENT", label: "عند التجهيز" },
  { value: "SHIPPING", label: "عند الشحن" },
];

/**
 * The five operational groups.
 *
 * Company *identity* is deliberately absent — it lives on Company and is
 * edited on the company profile.
 *
 * The `*NextNumber` counters are absent too: they are the company's document
 * sequences, and a client that can reset them can mint duplicate invoices.
 */
export const SETTINGS_SECTIONS: SettingsSectionDef[] = [
  {
    id: "accounting",
    title: "إعدادات المحاسبة",
    description: "الافتراضيات المالية المستخدمة في الفواتير والتقارير.",
    fields: [
      {
        key: "fiscalYearStartMonth",
        label: "بداية السنة المالية",
        type: "select",
        options: FISCAL_MONTHS,
      },
      { key: "invoicePrefix", label: "بادئة رقم الفاتورة", type: "text", placeholder: "INV" },
      { key: "defaultSalesVatRate", label: "نسبة ضريبة المبيعات الافتراضية %", type: "number" },
      { key: "defaultPurchaseVatRate", label: "نسبة ضريبة المشتريات الافتراضية %", type: "number" },
    ],
  },
  {
    id: "inventory",
    title: "إعدادات المخزون",
    description: "طريقة خصم المخزون والحدود الافتراضية للتنبيهات.",
    fields: [
      {
        key: "stockCommitPoint",
        label: "خصم الكمية عند",
        type: "select",
        options: STOCK_COMMIT_POINTS,
      },
      { key: "allowNegativeStock", label: "السماح بالبيع بالسالب", type: "bool" },
      { key: "defaultLowStockThreshold", label: "حد المخزون الأدنى الافتراضي", type: "number" },
      { key: "defaultReorderQuantity", label: "كمية إعادة الطلب الافتراضية", type: "number" },
      { key: "enableExpiryTracking", label: "تفعيل تتبع تواريخ الصلاحية", type: "bool" },
    ],
  },
  {
    id: "purchases",
    title: "إعدادات المشتريات",
    description: "الافتراضيات الخاصة بأوامر الشراء والموردين.",
    fields: [
      {
        key: "purchaseOrderPrefix",
        label: "بادئة رقم أمر الشراء",
        type: "text",
        placeholder: "PO",
      },
      { key: "defaultPaymentTermsDays", label: "مهلة السداد الافتراضية (يوم)", type: "number" },
      { key: "requireSupplierInvoice", label: "اشتراط فاتورة المورد قبل الدفع", type: "bool" },
      { key: "allowOverReceipt", label: "السماح باستلام أكثر من الكمية المطلوبة", type: "bool" },
    ],
  },
  {
    id: "sales",
    title: "إعدادات المبيعات",
    description: "سلوك دورة الطلب من الإضافة حتى التسليم.",
    fields: [
      { key: "orderPrefix", label: "بادئة رقم الطلب", type: "text", placeholder: "ORD" },
      { key: "requireOrderConfirmation", label: "اشتراط تأكيد الطلب قبل التجهيز", type: "bool" },
      { key: "allowManualDiscount", label: "السماح بخصم يدوي على الطلبات", type: "bool" },
      { key: "defaultOrderValidityHours", label: "صلاحية الطلب المؤجل (ساعة)", type: "number" },
    ],
  },
  {
    id: "shipping",
    title: "إعدادات الشحن",
    description: "الافتراضيات المستخدمة في حساب الشحن على الطلبات.",
    fields: [
      { key: "defaultShippingCost", label: "تكلفة الشحن الافتراضية", type: "number" },
      { key: "freeShippingThreshold", label: "حد الشحن المجاني (إجمالي الطلب)", type: "number" },
      { key: "returnShippingCost", label: "تكلفة شحن المرتجعات", type: "number" },
    ],
  },
];

export function findSection(id: string): SettingsSectionDef {
  const section = SETTINGS_SECTIONS.find((candidate) => candidate.id === id);
  // The call sites use fixed ids that exist above; throwing rather than
  // returning undefined keeps the non-null assertion out of the JSX.
  if (!section) throw new Error(`Unknown settings section: ${id}`);
  return section;
}
