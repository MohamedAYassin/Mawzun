// Arabic labels for the enum values the API returns verbatim.
//
// The order-status map had been copy-pasted into nine page components, which is
// exactly how orders-transactions ended up rendering raw CANCELLED / NEW /
// POSTPONED in its status column: that page simply never got a copy. New code
// imports the label from here instead of re-declaring it.
//
// NOTE: the nine pre-existing copies are deliberately left alone for now — seven
// are byte-identical to these values but two (CustomersManagement,
// OrderInvoice) use different wording for DELIVERED and RETURNED_TO_WAREHOUSE,
// so folding them in is a copy change that needs its own decision.
//
// Values are formal فصحى and match the wording already used across the app.

/** Order status — the values on orders.status. */
export const ORDER_STATUS_AR: Record<string, string> = {
  NEW: 'جديد',
  CONFIRMED: 'مؤكد',
  POSTPONED: 'مؤجل',
  CANCELLED: 'ملغي',
  NO_ANSWER: 'لا يرد',
  DELIVERED: 'تم التسليم',
  RETURNED: 'مرتجع',
  NOT_DELIVERED: 'لم يُسلّم',
  ON_THE_WAY: 'في الطريق',
  RETURNED_TO_WAREHOUSE: 'رُجع للمخزن',
}

/** Purchase order status — purchase_orders.status. */
export const PURCHASE_ORDER_STATUS_AR: Record<string, string> = {
  DRAFT: 'مسودة',
  ORDERED: 'تم الطلب',
  PARTIALLY_RECEIVED: 'مستلم جزئياً',
  RECEIVED: 'مستلم',
  CANCELLED: 'ملغي',
}

/**
 * Sync-error types — the values on sync_errors.errorType.
 *
 * These are written by the webhook worker (and the backend's local ingest
 * mirror) as raw topic names, so the column mixes two conventions: webhook
 * topics (`orders/create`) and synthetic codes (`UNMAPPED_SKU`). Both are
 * internal identifiers, never meant for an operator to read — the page used to
 * render them verbatim, so a merchant saw "PRODUCT_EXPORT" in English.
 *
 * The full set is enumerated from the writers, not guessed:
 *   shopify_integration/src/index.ts  (topic, UNMAPPED_SKU, CANCEL_AFTER_SHIP,
 *     FULFILLMENT_NO_ORDER, INVENTORY_PUSH*, orders/cancelled, orders/fulfilled,
 *     products/update)
 *   api/src/modules/system/shopifyIngestLocal.ts  (UNMAPPED_SKU)
 *   api/src/modules/system/shopifyProductExport.ts  (PRODUCT_EXPORT)
 * The two retryable order topics (orders/create, orders/updated) are error
 * types too: an ingest failure records the topic it was handling.
 *
 * NOT translated here: the platform admin console (admin/) shows these
 * codes deliberately — it is an English-language operator surface.
 */
export const SYNC_ERROR_TYPE_AR: Record<string, string> = {
  // Order ingest
  'orders/create': 'فشل استيراد طلب جديد',
  'orders/updated': 'فشل تحديث طلب',
  'orders/cancelled': 'فشل إلغاء طلب',
  'orders/fulfilled': 'فشل تحديث حالة شحن',
  // Product ingest + export
  'products/update': 'فشل تحديث منتج',
  PRODUCT_EXPORT: 'فشل تصدير منتج إلى المتجر',
  // Data problems
  UNMAPPED_SKU: 'صنف بدون مطابقة SKU',
  CANCEL_AFTER_SHIP: 'إلغاء بعد الشحن',
  FULFILLMENT_NO_ORDER: 'إشعار شحن لطلب غير موجود',
  // Inventory push (cron)
  INVENTORY_PUSH: 'فشل رفع المخزون',
  INVENTORY_PUSH_PARTIAL: 'رفع المخزون جزئي',
  INVENTORY_PUSH_RATE_LIMITED: 'تأجيل رفع المخزون (حد المعدل)',
}

/**
 * Look a value up, falling back to the raw value so an unmapped enum member is
 * visible rather than rendering as blank.
 */
export function labelOf(map: Record<string, string>, value: string | null | undefined): string {
  if (!value) return '—'
  return map[value] ?? value
}
