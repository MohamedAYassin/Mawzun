import { http } from "./http";

// Per-company operational settings.
//
// This used to be a scope/key/value table with every value stored as text,
// which forced a runtime string-to-type coercion on every read and made
// settings impossible to query, default or validate in the database. It is now
// one typed row per company.
//
// Company *identity* — name, tax number, address — is not here. It lives on
// Company and is edited through companyApi.

export type StockCommitPoint = "CONFIRMATION" | "FULFILLMENT" | "SHIPPING";

export interface CompanySettings {
  id: string;
  companyId: string;
  createdAt: string;
  updatedAt: string;

  // Accounting
  fiscalYearStartMonth: number;
  invoicePrefix: string;
  invoiceNextNumber: number;
  defaultSalesVatRate: number;
  defaultPurchaseVatRate: number;

  // Inventory
  stockCommitPoint: StockCommitPoint;
  allowNegativeStock: boolean;
  defaultLowStockThreshold: number;
  defaultReorderQuantity: number;
  enableExpiryTracking: boolean;

  // Purchases
  purchaseOrderPrefix: string;
  purchaseNextNumber: number;
  defaultPaymentTermsDays: number;
  requireSupplierInvoice: boolean;
  allowOverReceipt: boolean;

  // Production
  productionBatchPrefix: string;
  productionNextNumber: number;

  // Sales
  orderPrefix: string;
  orderNextNumber: number;
  requireOrderConfirmation: boolean;
  allowManualDiscount: boolean;
  defaultOrderValidityHours: number;

  // Shipping
  defaultShippingCost: number;
  freeShippingThreshold: number;
  returnShippingCost: number;

  // Integrations
  shopifyEnabled: boolean;
}

/**
 * The editable subset.
 *
 * The `*NextNumber` counters are deliberately absent: they are the company's
 * document sequence, and letting a client reset them would silently produce
 * duplicate invoice, order and batch numbers.
 */
export interface UpdateSettingsInput {
  fiscalYearStartMonth?: number;
  invoicePrefix?: string;
  defaultSalesVatRate?: number;
  defaultPurchaseVatRate?: number;

  stockCommitPoint?: StockCommitPoint;
  allowNegativeStock?: boolean;
  defaultLowStockThreshold?: number;
  defaultReorderQuantity?: number;
  enableExpiryTracking?: boolean;

  purchaseOrderPrefix?: string;
  defaultPaymentTermsDays?: number;
  requireSupplierInvoice?: boolean;
  allowOverReceipt?: boolean;

  orderPrefix?: string;
  requireOrderConfirmation?: boolean;
  allowManualDiscount?: boolean;
  defaultOrderValidityHours?: number;

  defaultShippingCost?: number;
  freeShippingThreshold?: number;
  returnShippingCost?: number;
}

export const settingsApi = {
  get: () => http.get<CompanySettings>("/settings"),

  update: (input: UpdateSettingsInput) => http.patch<CompanySettings>("/settings", input),
};
