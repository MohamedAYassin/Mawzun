// The resource declarations.
//
// Each entry is one dashboard resource family, expressed as data so the five
// routes are generated rather than hand-written (see resources.ts for why).
//
// The declarations were written against the live schema — column names, null
// constraints and enum values were read from `information_schema`, not from
// memory. Two things that check caught, either of which would have broken every
// insert:
//   - `createdAt`/`updatedAt` are NOT NULL with no database default on these
//     tables (Prisma supplies them client-side), so raw SQL must write them.
//     That is what `hasUpdatedAt` controls.
//   - enum columns are real Postgres enums, so an invalid value is a 500 from
//     the driver unless it is validated first. `values` makes it a 400 instead.

import { defineResource, type ResourceSpec } from "./resources";
import type { Route } from "./routes";

// Enum values, mirrored from the Prisma schema. Kept here rather than imported
// because this Worker has no Prisma client — it speaks raw SQL by design.
// Read from pg_enum, not from the Prisma schema's comments — the two disagree.
// A wrong list here is worse than no list: it lets an invalid value through
// validation, so the client gets a 500 from the driver instead of a 400 that
// names the allowed values.
const ATTRIBUTE_TYPE = ["TEXT", "SELECT", "COLOR"] as const;
const RESERVATION_METHOD = ["MANUAL", "AT_CONFIRMATION", "AT_FULFILLMENT"] as const;
const CARRIER_TYPE = ["INTEGRATED", "MANUAL"] as const;
const FULFILLMENT_TYPE = ["PICKING", "PACKING"] as const;
const FULFILLMENT_STATUS = ["NEW", "DONE", "CANCELLED"] as const;

// NOTE: /v1/vendors is NOT declared here. It already has all five verbs
// hand-written in writes.ts, and generated routes are registered last so they
// cannot shadow them — declaring it would be dead code. Anything with a
// bespoke handler stays hand-written; this list is only the gaps.
const RESOURCES: ResourceSpec[] = [
  {
    path: "/v1/categories",
    table: "categories",
    label: "category",
    softDelete: true,
    hasUpdatedAt: true,
    select: 'id, name, slug, description, "imageUrl", "isActive", "sortOrder", "parentId", "createdAt", "updatedAt"',
    fields: [
      { col: "name", type: "string", required: true, max: 255 },
      { col: "description", type: "text", max: 4000 },
      { col: "imageUrl", type: "string", max: 2000 },
      { col: "isActive", type: "bool", fallback: true },
      { col: "sortOrder", type: "int", fallback: 0, min: 0 },
      { col: "parentId", type: "string", fk: { table: "categories", label: "parentId" } },
    ],
  },
  {
    path: "/v1/brands",
    table: "brands",
    label: "brand",
    softDelete: true,
    hasUpdatedAt: true,
    select: 'id, name, slug, description, "logoUrl", "isActive", "createdAt", "updatedAt"',
    fields: [
      { col: "name", type: "string", required: true, max: 255 },
      { col: "description", type: "text", max: 4000 },
      { col: "logoUrl", type: "string", max: 2000 },
      { col: "isActive", type: "bool", fallback: true },
    ],
  },
  {
    path: "/v1/uoms",
    table: "uoms",
    label: "uom",
    // uoms has no deletedAt: deleting one is a real delete, and the FK from
    // products is Restrict so Postgres refuses if it is in use.
    softDelete: false,
    hasUpdatedAt: true,
    select: 'id, code, name, category, "isActive", "createdAt", "updatedAt"',
    fields: [
      { col: "code", type: "string", required: true, max: 20 },
      { col: "name", type: "string", required: true, max: 100 },
      { col: "category", type: "string", required: true, max: 50 },
      { col: "isActive", type: "bool", fallback: true },
    ],
  },
  {
    path: "/v1/tax-rates",
    table: "tax_rates",
    label: "tax rate",
    softDelete: true,
    hasUpdatedAt: true,
    select: 'id, name, percentage, "isDefault", "isActive", "createdAt", "updatedAt"',
    fields: [
      { col: "name", type: "string", required: true, max: 100 },
      { col: "percentage", type: "num", required: true, min: 0, max: 100 },
      { col: "isDefault", type: "bool", fallback: false },
      { col: "isActive", type: "bool", fallback: true },
    ],
  },
  {
    path: "/v1/attributes",
    table: "product_attributes",
    label: "attribute",
    softDelete: true,
    hasUpdatedAt: true,
    select: 'id, name, code, type, "isActive", "sortOrder", "createdAt", "updatedAt"',
    fields: [
      { col: "name", type: "string", required: true, max: 100 },
      { col: "code", type: "string", required: true, max: 50 },
      { col: "type", type: "string", required: true, values: ATTRIBUTE_TYPE },
      { col: "isActive", type: "bool", fallback: true },
      { col: "sortOrder", type: "int", fallback: 0, min: 0 },
    ],
  },
  {
    path: "/v1/attribute-values",
    table: "product_attribute_values",
    label: "attribute value",
    softDelete: true,
    hasUpdatedAt: true,
    select: 'id, "attributeId", value, "colorHex", "skuSuffix", barcode, "sortOrder", "isActive", "createdAt", "updatedAt"',
    fields: [
      { col: "attributeId", type: "string", required: true, fk: { table: "product_attributes", label: "attributeId" } },
      { col: "value", type: "string", required: true, max: 255 },
      { col: "colorHex", type: "string", max: 9 },
      { col: "skuSuffix", type: "string", max: 50 },
      { col: "barcode", type: "string", max: 100 },
      { col: "sortOrder", type: "int", fallback: 0, min: 0 },
      { col: "isActive", type: "bool", fallback: true },
    ],
  },
  {
    path: "/v1/warehouses",
    table: "warehouses",
    label: "warehouse",
    softDelete: true,
    hasUpdatedAt: true,
    select: 'id, name, code, address, city, "countryCode", "phoneNumber", notes, "isActive", "isDefault", "createdAt", "updatedAt"',
    fields: [
      { col: "name", type: "string", required: true, max: 150 },
      { col: "code", type: "string", max: 50 },
      { col: "address", type: "text", max: 500 },
      { col: "city", type: "string", max: 100 },
      { col: "countryCode", type: "string", max: 2 },
      { col: "phoneNumber", type: "string", max: 30 },
      { col: "notes", type: "text", max: 1000 },
      { col: "isActive", type: "bool", fallback: true },
      { col: "isDefault", type: "bool", fallback: false },
    ],
  },
  {
    path: "/v1/storage-locations",
    table: "storage_locations",
    label: "storage location",
    softDelete: true,
    hasUpdatedAt: true,
    select: 'id, "warehouseId", name, code, notes, "isActive", "parentId", "maxWeightKg", "maxVolumeM3", "createdAt", "updatedAt"',
    fields: [
      { col: "warehouseId", type: "string", required: true, fk: { table: "warehouses", label: "warehouseId" } },
      { col: "name", type: "string", required: true, max: 150 },
      { col: "code", type: "string", max: 50 },
      { col: "notes", type: "text", max: 1000 },
      { col: "isActive", type: "bool", fallback: true },
      { col: "parentId", type: "string", fk: { table: "storage_locations", label: "parentId" } },
      { col: "maxWeightKg", type: "num", min: 0 },
      { col: "maxVolumeM3", type: "num", min: 0 },
    ],
  },
  {
    path: "/v1/operation-types",
    table: "operation_types",
    label: "operation type",
    softDelete: true,
    hasUpdatedAt: true,
    select: 'id, name, code, description, "requiresValidation", "sequencePrefix", "reservationMethod", "isActive", "nextSequence", "createdAt", "updatedAt"',
    fields: [
      { col: "name", type: "string", required: true, max: 100 },
      { col: "code", type: "string", required: true, max: 50 },
      { col: "description", type: "text", max: 1000 },
      { col: "requiresValidation", type: "bool", fallback: false },
      { col: "sequencePrefix", type: "string", required: true, max: 20 },
      { col: "reservationMethod", type: "string", values: RESERVATION_METHOD },
      { col: "isActive", type: "bool", fallback: true },
    ],
  },
  {
    path: "/v1/reorder-points",
    table: "reorder_points",
    label: "reorder point",
    // No deletedAt and no updatedAt on this table — a plain association row.
    softDelete: false,
    hasUpdatedAt: false,
    select: 'id, "productId", "warehouseId", "minStockLevel", "maxStockLevel", "reorderQuantity"',
    orderBy: "id",
    fields: [
      { col: "productId", type: "string", required: true, fk: { table: "products", label: "productId" } },
      { col: "warehouseId", type: "string", required: true, fk: { table: "warehouses", label: "warehouseId" } },
      { col: "minStockLevel", type: "num", required: true, min: 0 },
      { col: "maxStockLevel", type: "num", required: true, min: 0 },
      { col: "reorderQuantity", type: "num", required: true, min: 0 },
    ],
  },
  {
    path: "/v1/order-sources",
    table: "order_sources",
    label: "order source",
    softDelete: true,
    hasUpdatedAt: true,
    select: 'id, name, "isActive", "createdAt", "updatedAt"',
    fields: [
      { col: "name", type: "string", required: true, max: 100 },
      { col: "isActive", type: "bool", fallback: true },
    ],
  },
  {
    path: "/v1/payment-methods",
    table: "payment_methods",
    label: "payment method",
    softDelete: true,
    hasUpdatedAt: true,
    select: 'id, name, "isActive", "createdAt", "updatedAt"',
    fields: [
      { col: "name", type: "string", required: true, max: 100 },
      { col: "isActive", type: "bool", fallback: true },
    ],
  },
  {
    path: "/v1/cancel-reasons",
    table: "cancel_reasons",
    label: "cancel reason",
    softDelete: true,
    hasUpdatedAt: true,
    select: 'id, name, "isActive", "createdAt", "updatedAt"',
    fields: [
      { col: "name", type: "string", required: true, max: 200 },
      { col: "isActive", type: "bool", fallback: true },
    ],
  },
  {
    path: "/v1/governorates",
    table: "governorates",
    label: "governorate",
    softDelete: true,
    hasUpdatedAt: true,
    select: 'id, name, code, "shippingCost", "isActive", "createdAt", "updatedAt"',
    fields: [
      { col: "name", type: "string", required: true, max: 100 },
      { col: "code", type: "string", max: 20 },
      { col: "shippingCost", type: "num", min: 0, fallback: 0 },
      { col: "isActive", type: "bool", fallback: true },
    ],
  },
  {
    path: "/v1/cities",
    table: "cities",
    label: "city",
    softDelete: true,
    hasUpdatedAt: true,
    select: 'id, name, code, "shippingCost", "isActive", "governorateId", "createdAt", "updatedAt"',
    fields: [
      { col: "name", type: "string", required: true, max: 100 },
      { col: "code", type: "string", max: 20 },
      { col: "shippingCost", type: "num", min: 0, fallback: 0 },
      { col: "isActive", type: "bool", fallback: true },
      { col: "governorateId", type: "string", required: true, fk: { table: "governorates", label: "governorateId" } },
    ],
  },
  {
    path: "/v1/carriers",
    table: "carriers",
    label: "carrier",
    softDelete: true,
    hasUpdatedAt: true,
    select: 'id, name, code, type, "isActive", "logoUrl", "trackingUrlTemplate", settings, "defaultShippingCost", "defaultCustomerShippingCost", "returnShippingCost", "autoSendOrderEnabled", "createdAt", "updatedAt"',
    fields: [
      { col: "name", type: "string", required: true, max: 150 },
      { col: "code", type: "string", required: true, max: 50 },
      { col: "type", type: "string", required: true, values: CARRIER_TYPE },
      { col: "isActive", type: "bool", fallback: true },
      { col: "logoUrl", type: "string", max: 2000 },
      { col: "trackingUrlTemplate", type: "string", max: 500 },
      { col: "settings", type: "json" },
      { col: "defaultShippingCost", type: "num", min: 0, fallback: 0 },
      { col: "defaultCustomerShippingCost", type: "num", min: 0, fallback: 0 },
      { col: "returnShippingCost", type: "num", min: 0, fallback: 0 },
      { col: "autoSendOrderEnabled", type: "bool", fallback: false },
    ],
  },
  {
    path: "/v1/fulfillment-batches",
    table: "fulfillment_batches",
    label: "fulfillment batch",
    softDelete: true,
    hasUpdatedAt: true,
    select: 'id, name, "warehouseId", type, status, "completedAt", "createdAt", "updatedAt"',
    fields: [
      { col: "name", type: "string", required: true, max: 150 },
      { col: "warehouseId", type: "string", required: true, fk: { table: "warehouses", label: "warehouseId" } },
      { col: "type", type: "string", required: true, values: FULFILLMENT_TYPE },
      { col: "status", type: "string", values: FULFILLMENT_STATUS },
      { col: "completedAt", type: "date" },
    ],
  },
];


// ── The four remaining user-facing families ────────────────────────────────
// Deliberately NOT included, with reasons, so the omissions read as decisions
// rather than oversights:
//   - `countries`: a global table with no companyId, so it cannot be
//     company-scoped. Exposing it would leak every tenant's view or let one
//     company edit rows another depends on.
//   - `product-images`: already reachable — POST/PATCH /v1/products accept
//     `images[]` and replace the set atomically.
//   - `api-keys`, `sessions`, `stores`, `sync-errors`: operator/security
//     surfaces. A key that can mint keys or read sealed store tokens is a
//     privilege-escalation path, not a business action.
const PURCHASE_ORDER_STATUS = ["DRAFT", "ORDERED", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"] as const;
const STOCK_COUNT_STATUS = ["DRAFT", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const;
const PRODUCTION_BATCH_STATUS = ["DRAFT", "PLANNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const;

const MORE_RESOURCES: ResourceSpec[] = [
  {
    path: "/v1/purchase-orders",
    table: "purchase_orders",
    label: "purchase order",
    softDelete: true,
    hasUpdatedAt: true,
    select: 'id, "orderNumber", "vendorId", status, notes, "totalAmount", "expectedAt", "receivedAt", "cancelledAt", "createdAt", "updatedAt"',
    fields: [
      { col: "orderNumber", type: "string", required: true, max: 100 },
      { col: "vendorId", type: "string", required: true, fk: { table: "vendors", label: "vendorId" } },
      { col: "status", type: "string", values: PURCHASE_ORDER_STATUS },
      { col: "notes", type: "text", max: 2000 },
      { col: "totalAmount", type: "num", min: 0 },
      { col: "expectedAt", type: "date" },
      { col: "receivedAt", type: "date" },
    ],
  },
  {
    path: "/v1/shipping-returns",
    table: "shipping_returns",
    label: "shipping return",
    softDelete: true,
    hasUpdatedAt: true,
    select: 'id, "referenceNumber", "orderId", "customerId", "carrierId", "qtyReturnedGood", "qtyReturnedDamaged", "qtyReturnedMissing", "amountTotal", "shippingCost", "amountWithShipping", "returnsCollected", "returnsCollectedAt", notes, "createdAt", "updatedAt"',
    fields: [
      { col: "referenceNumber", type: "string", required: true, max: 100 },
      { col: "orderId", type: "string", required: true, fk: { table: "orders", label: "orderId" } },
      { col: "customerId", type: "string", fk: { table: "customers", label: "customerId" } },
      { col: "carrierId", type: "string", fk: { table: "carriers", label: "carrierId" } },
      { col: "qtyReturnedGood", type: "int", min: 0, fallback: 0 },
      { col: "qtyReturnedDamaged", type: "int", min: 0, fallback: 0 },
      { col: "qtyReturnedMissing", type: "int", min: 0, fallback: 0 },
      { col: "amountTotal", type: "num", min: 0 },
      { col: "shippingCost", type: "num", min: 0 },
      { col: "amountWithShipping", type: "num", min: 0 },
      { col: "returnsCollected", type: "bool", fallback: false },
      { col: "returnsCollectedAt", type: "date" },
      { col: "notes", type: "text", max: 2000 },
    ],
  },
  {
    path: "/v1/stock-counts",
    table: "stock_counts",
    label: "stock count",
    softDelete: true,
    hasUpdatedAt: true,
    select: 'id, "referenceNumber", "warehouseId", "storageLocationId", status, reason, notes, "startedAt", "completedAt", "createdAt", "updatedAt"',
    fields: [
      { col: "referenceNumber", type: "string", required: true, max: 100 },
      { col: "warehouseId", type: "string", fk: { table: "warehouses", label: "warehouseId" } },
      { col: "storageLocationId", type: "string", fk: { table: "storage_locations", label: "storageLocationId" } },
      { col: "status", type: "string", values: STOCK_COUNT_STATUS },
      { col: "reason", type: "string", max: 500 },
      { col: "notes", type: "text", max: 2000 },
      { col: "startedAt", type: "date" },
      { col: "completedAt", type: "date" },
    ],
  },
  {
    path: "/v1/production-batches",
    table: "production_batches",
    label: "production batch",
    softDelete: true,
    hasUpdatedAt: true,
    select: 'id, "batchNumber", status, notes, "startDate", "completionDate", "cancelledAt", "createdAt", "updatedAt"',
    fields: [
      { col: "batchNumber", type: "string", required: true, max: 100 },
      { col: "status", type: "string", values: PRODUCTION_BATCH_STATUS },
      { col: "notes", type: "text", max: 2000 },
      { col: "startDate", type: "date" },
      { col: "completionDate", type: "date" },
    ],
  },
];

/**
 * Registers every declared resource.
 *
 * Called from routes.ts so reads, writes and generated CRUD share ONE route
 * table — a second registry would mean two places to look when a path 404s.
 */
export function registerResources(all: Route[]): void {
  for (const spec of [...RESOURCES, ...MORE_RESOURCES]) defineResource(spec, all);
}
