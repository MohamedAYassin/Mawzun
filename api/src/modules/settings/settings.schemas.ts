import { z } from "zod";

// Decimal columns are read as strings over JSON, so both are accepted and
// coerced. The database column stays numeric — this is a transport concern.
const money = z.coerce.number().min(0, "القيمة لا يمكن أن تكون سالبة.").max(99_999_999);
const percent = z.coerce.number().min(0).max(100);
const quantity = z.coerce.number().min(0).max(9_999_999);

/**
 * Number prefixes are editable, but the counters next to them are not: they
 * are the company's invoice sequence and letting a client reset it would
 * silently produce duplicate document numbers.
 */
export const UpdateSettingsSchema = z
  .object({
    fiscalYearStartMonth: z.coerce.number().int().min(1).max(12).optional(),
    invoicePrefix: z.string().trim().min(1).max(20).optional(),
    defaultSalesVatRate: percent.optional(),
    defaultPurchaseVatRate: percent.optional(),

    stockCommitPoint: z.enum(["CONFIRMATION", "FULFILLMENT", "SHIPPING"]).optional(),
    allowNegativeStock: z.boolean().optional(),
    defaultLowStockThreshold: quantity.optional(),
    defaultReorderQuantity: quantity.optional(),
    enableExpiryTracking: z.boolean().optional(),

    purchaseOrderPrefix: z.string().trim().min(1).max(20).optional(),
    defaultPaymentTermsDays: z.coerce.number().int().min(0).max(365).optional(),
    requireSupplierInvoice: z.boolean().optional(),
    allowOverReceipt: z.boolean().optional(),

    orderPrefix: z.string().trim().min(1).max(20).optional(),
    requireOrderConfirmation: z.boolean().optional(),
    allowManualDiscount: z.boolean().optional(),
    defaultOrderValidityHours: z.coerce.number().int().min(1).max(8760).optional(),

    defaultShippingCost: money.optional(),
    freeShippingThreshold: money.optional(),
    returnShippingCost: money.optional(),

  })
  .strict();

export type UpdateSettingsInput = z.infer<typeof UpdateSettingsSchema>;
