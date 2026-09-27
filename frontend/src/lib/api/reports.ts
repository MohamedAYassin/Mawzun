import { http, type Page } from "./http";
import type { ListQuery } from "./catalog";
import type { OrderStatus } from "./sales";

// Reports: read-only aggregates for the home screen and the reporting pages.
//
// Nothing here writes. Every payload is a handful of numbers computed in SQL
// rather than a table loaded into the browser — the previous implementation
// pulled every row into memory to count it, so the dashboard got slower the
// more data a company had.

export interface DateRange {
  from?: string;
  to?: string;
}

// ---------------------------------------------------------------------------
// Dashboard cards
// ---------------------------------------------------------------------------

export interface ProductOverview {
  totalProducts: number;
  activeProducts: number;
  lowStockProducts: number;
  outOfStockProducts: number;
}

export interface InventoryOverview {
  totalQuantity: number;
  availableQuantity: number;
  reservedQuantity: number;
  totalValue: number;
  totalIn: number;
  totalOut: number;
}

export interface OrdersOverview {
  orderCount: number;
  totalAmount: number;
  totalQuantity: number;
  averageOrderPrice: number;
  /** Orders that reached DELIVERED. */
  deliveredCount: number;
  totalReturnedAmount: number;
  netRevenue: number;
}

export interface PurchasesOverview {
  receivedCount: number;
  receivedAmount: number;
  pendingCount: number;
  pendingAmount: number;
  cancelledCount: number;
}

export interface ShippingOverview {
  totalShipments: number;
  deliveredCount: number;
  deliveredAmount: number;
  returnedCount: number;
  returnedAmount: number;
  notDeliveredCount: number;
  totalShippingCost: number;
}

// ---------------------------------------------------------------------------
// Order reports
// ---------------------------------------------------------------------------

export interface OrderTotals {
  totalAmount: number;
  orderCount: number;
  totalQuantity: number;
  averageOrderPrice: number;
  averageItemsPerOrder: number;
  totalReturnedAmount: number;
  netRevenue: number;
  topCategory: { categoryId: string | null; categoryName: string; quantity: number } | null;
  topEmployee: {
    employeeId: string | null;
    employeeName: string | null;
    orderCount: number;
  } | null;
}

export interface GraphPoint {
  date: string;
  value: number;
  count: number;
}

export interface OrderGraph extends DateRange {
  points: GraphPoint[];
}

export interface StatusDistribution {
  totalOrders: number;
  statuses: { status: OrderStatus; count: number; percentage: number }[];
}

export interface SourceDistribution {
  totalOrders: number;
  sources: {
    sourceId: string | null;
    sourceName: string | null;
    count: number;
    percentage: number;
  }[];
}

export interface ConfirmedOrdersStats {
  count: number;
  totalAmount: number;
  deliveredCount: number;
  deliveryPercentage: number;
}

export interface TopProduct {
  productId: string | null;
  productName: string | null;
  skuCode: string | null;
  totalQuantity: number;
  revenue: number;
  cost: number;
  grossProfit: number;
  percentage: number;
}

export interface TopCategory {
  categoryId: string | null;
  categoryName: string;
  totalQuantity: number;
  percentage: number;
}

export interface TopEmployee {
  employeeId: string;
  employeeName: string | null;
  orderCount: number;
  totalAmount: number;
  percentage: number;
}

export interface TopReturnReason {
  reasonId: string | null;
  reasonName: string | null;
  count: number;
  percentage: number;
}

export interface ProductConfirmation {
  productId: string;
  productName: string;
  skuCode: string | null;
  totalOrders: number;
  confirmedOrders: number;
  confirmationPercentage: number;
}

// ---------------------------------------------------------------------------
// Carrier reports
// ---------------------------------------------------------------------------

export interface CarrierUsage {
  carrierId: string;
  carrierName: string;
  ordersCount: number;
  percentage: number;
}
export interface CarrierSpeed {
  carrierId: string;
  carrierName: string;
  averageDeliveryDays: number | null;
  deliveredOrders: number;
}
export interface CarrierSuccess {
  carrierId: string;
  carrierName: string;
  confirmedOrders: number;
  deliveredOrders: number;
  returnedOrders: number;
  successPercentage: number;
}
export interface CarrierCost {
  carrierId: string;
  carrierName: string;
  totalShippingCost: number;
  averageShippingCost: number;
  ordersCount: number;
}
/** @deprecated Use the per-endpoint types above; kept for backwards compat. */
export type CarrierStat = CarrierUsage;

export interface CitySuccessRate {
  cityId: string | null;
  cityName: string | null;
  confirmedOrders: number;
  deliveredOrders: number;
  returnedOrders: number;
  successPercentage: number;
}

// ---------------------------------------------------------------------------
// Stock report
// ---------------------------------------------------------------------------

export interface StockReportRow {
  id: string;
  productId: string;
  productName: string;
  skuCode: string | null;
  categoryName: string | null;
  locationId: string;
  locationName: string;
  locationCode: string | null;
  warehouseId: string;
  warehouseName: string;
  quantityOnHand: number;
  reservedQuantity: number;
  availableQuantity: number;
  unitCost: number;
  totalCost: number;
}

/** One row of the per-location report: stock rolled up by storage location. */
export interface LocationStockRow {
  locationId: string;
  locationName: string;
  locationCode: string | null;
  warehouseId: string;
  warehouseName: string;
  productCount: number;
  quantityOnHand: number;
  reservedQuantity: number;
  availableQuantity: number;
  totalCost: number;
}

export interface StockReportFilter extends ListQuery {
  warehouseId?: string;
  locationId?: string;
  categoryId?: string;
  onlyInStock?: boolean;
}

// ---------------------------------------------------------------------------
// Command pages: attention queues + movement trends
// ---------------------------------------------------------------------------

export interface OrdersAttention {
  newOrders: { count: number; value: number; oldestCreatedAt: string | null };
  noAnswer: { count: number };
  postponed: { count: number };
  confirmed: { count: number };
  onTheWay: { count: number };
  stuckOnTheWay: { count: number; olderThanDays: number };
}

export interface StockAttentionItem {
  productId: string;
  name: string;
  skuCode: string | null;
  onHand?: number;
  threshold?: number;
}

export interface StockAttention {
  outOfStock: { total: number; items: StockAttentionItem[] };
  lowStock: { total: number; items: StockAttentionItem[] };
  openCounts: number;
  pendingOperations: number;
}

export interface StockMovements {
  days: number;
  points: { date: string; in: number; out: number }[];
}

export const reportsApi = {
  // Dashboard cards.
  productOverview: () => http.get<ProductOverview>("/reports/overview/products"),
  inventoryOverview: () => http.get<InventoryOverview>("/reports/overview/inventory"),
  ordersOverview: () => http.get<OrdersOverview>("/reports/overview/orders"),
  purchasesOverview: () => http.get<PurchasesOverview>("/reports/overview/purchases"),
  shippingOverview: () => http.get<ShippingOverview>("/reports/overview/shipping"),

  // Order reports.
  orderTotals: (query: DateRange = {}) => http.get<OrderTotals>("/reports/orders/totals", query),
  orderGraph: (query: DateRange & { days?: number } = {}) =>
    http.get<OrderGraph>("/reports/orders/graph", query),
  statusDistribution: (query: DateRange = {}) =>
    http.get<StatusDistribution>("/reports/orders/status-distribution", query),
  sourceDistribution: (query: DateRange = {}) =>
    http.get<SourceDistribution>("/reports/orders/source-distribution", query),
  confirmedOrdersStats: (query: DateRange = {}) =>
    http.get<ConfirmedOrdersStats>("/reports/orders/confirmed", query),
  topProducts: (query: DateRange & { top?: number } = {}) =>
    http.get<{ products: TopProduct[] }>("/reports/orders/top-products", query),
  topCategories: (query: DateRange & { top?: number } = {}) =>
    http.get<{ categories: TopCategory[] }>("/reports/orders/top-categories", query),
  topEmployees: (query: DateRange & { top?: number } = {}) =>
    http.get<{ employees: TopEmployee[] }>("/reports/orders/top-employees", query),
  topReturnReasons: (query: DateRange & { top?: number } = {}) =>
    http.get<TopReturnReason & { totalOrders: number; reasons: TopReturnReason[] }>(
      "/reports/orders/top-return-reasons",
      query,
    ),
  productConfirmation: (query: DateRange = {}) =>
    http.get<{ products: ProductConfirmation[] }>("/reports/orders/product-confirmation", query),

  // Carrier reports.
  mostUsedCarriers: (query: DateRange & { top?: number } = {}) =>
    http.get<{ carriers: CarrierUsage[] }>("/reports/carriers/most-used", query),
  fastestCarriers: (query: DateRange & { top?: number } = {}) =>
    http.get<{ carriers: CarrierSpeed[] }>("/reports/carriers/fastest", query),
  carrierSuccessRate: (query: DateRange & { top?: number } = {}) =>
    http.get<{ carriers: CarrierSuccess[] }>("/reports/carriers/success-rate", query),
  carrierCostStats: (query: DateRange & { top?: number } = {}) =>
    http.get<{ carriers: CarrierCost[] }>("/reports/carriers/cost-stats", query),
  carrierCitySuccessRate: (carrierId: string) =>
    http.get<{ cities: CitySuccessRate[] }>(`/reports/carriers/${carrierId}/city-success-rate`),

  // Stock report.
  stockReport: (query: StockReportFilter = {}) =>
    http.get<Page<StockReportRow>>("/reports/stock", query),
  /** Same stock_levels data rolled up by storage location. */
  stockByLocation: (query: StockReportFilter = {}) =>
    http.get<Page<LocationStockRow>>("/reports/stock/locations", query),
  stockTotals: (query: StockReportFilter = {}) =>
    http.get<{
      totalQuantity: number;
      reservedQuantity: number;
      availableQuantity: number;
      totalCost: number;
      rowCount: number;
      // Legacy key kept for callers that still read totalValue.
      totalValue?: number;
    }>("/reports/stock/totals", query),

  // Command pages.
  ordersAttention: () => http.get<OrdersAttention>("/reports/orders/attention"),
  stockAttention: () => http.get<StockAttention>("/reports/stock/attention"),
  stockMovements: (query: { days?: number } = {}) =>
    http.get<StockMovements>("/reports/stock/movements", query),
};
