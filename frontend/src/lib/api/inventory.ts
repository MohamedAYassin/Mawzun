import { http, type Page } from "./http";
import type { ListQuery, Ref } from "./catalog";

// Inventory: where stock is, how much of it there is, and every movement that
// changed it.
//
// The ledger (`/inventory/stock/transactions`) is read-only by design. There is
// no create or delete for a movement, because a ledger you can edit is not a
// ledger — corrections are new movements with a reason, never silent rewrites.

// ---------------------------------------------------------------------------
// Warehouses
// ---------------------------------------------------------------------------

export interface Warehouse {
  id: string;
  name: string;
  code: string | null;
  address: string | null;
  city: string | null;
  countryCode: string | null;
  phoneNumber: string | null;
  notes: string | null;
  isActive: boolean;
  isDefault: boolean;
  createdAt: string;
  _count: { storageLocations: number };
}

export interface CreateWarehouseInput {
  name: string;
  code?: string | null;
  address?: string | null;
  city?: string | null;
  countryCode?: string | null;
  phoneNumber?: string | null;
  notes?: string | null;
  isActive?: boolean;
  isDefault?: boolean;
}

export type UpdateWarehouseInput = Partial<CreateWarehouseInput>;

// ---------------------------------------------------------------------------
// Storage locations
// ---------------------------------------------------------------------------

export interface StorageLocation {
  id: string;
  name: string;
  code: string | null;
  warehouseId: string;
  parentId: string | null;
  notes: string | null;
  isActive: boolean;
  maxWeightKg: number | null;
  maxVolumeM3: number | null;
  createdAt: string;
  warehouse: Ref;
}

export interface CreateStorageLocationInput {
  name: string;
  code?: string | null;
  warehouseId: string;
  parentId?: string | null;
  notes?: string | null;
  isActive?: boolean;
  maxWeightKg?: number | null;
  maxVolumeM3?: number | null;
}

export type UpdateStorageLocationInput = Partial<CreateStorageLocationInput>;

export interface StorageLocationFilter extends ListQuery {
  warehouseId?: string;
  isActive?: boolean;
}

// ---------------------------------------------------------------------------
// Operation types
// ---------------------------------------------------------------------------

export type ReservationMethod = "MANUAL" | "AT_CONFIRMATION" | "AT_FULFILLMENT";

export interface OperationType {
  id: string;
  name: string;
  code: string;
  description: string | null;
  requiresValidation: boolean;
  sequencePrefix: string;
  reservationMethod: ReservationMethod;
  isActive: boolean;
  nextSequence: number;
  createdAt: string;
}

export interface CreateOperationTypeInput {
  name: string;
  code: string;
  description?: string | null;
  requiresValidation?: boolean;
  sequencePrefix?: string;
  reservationMethod?: ReservationMethod;
  isActive?: boolean;
}

export type UpdateOperationTypeInput = Partial<CreateOperationTypeInput>;

// ---------------------------------------------------------------------------
// Stock levels and movements
// ---------------------------------------------------------------------------

export interface StockLevel {
  id: string;
  onHand: number;
  reserved: number;
  /** Computed server-side: onHand − reserved. */
  available: number;
  product: {
    id: string;
    name: string;
    skuCode: string | null;
    trackStock: boolean;
    uom: { code: string } | null;
  };
  storageLocation: {
    id: string;
    name: string;
    code: string;
    warehouse: Ref;
  };
}

export interface InventoryTransaction {
  id: string;
  transactionType: string;
  quantity: number;
  balanceAfter: number;
  unitCost: string | null;
  reason: string | null;
  referenceType: string | null;
  referenceId: string | null;
  referenceNumber: string | null;
  createdAt: string;
  product: { id: string; name: string; skuCode: string | null };
  storageLocation: { id: string; name: string; warehouse: Ref };
  actor: { id: string; fullName: string } | null;
}

export interface StockFilter extends ListQuery {
  warehouseId?: string;
  storageLocationId?: string;
  productId?: string;
  onlyPositive?: boolean;
}

export interface AdjustStockInput {
  productId: string;
  storageLocationId: string;
  /** The quantity the shelf should hold *after* the correction. */
  countedQuantity: number;
  reason?: string | null;
}

export interface TransferStockInput {
  productId: string;
  fromStorageLocationId: string;
  toStorageLocationId: string;
  quantity: number;
  reason?: string | null;
}

// ---------------------------------------------------------------------------
// Stock operations
// ---------------------------------------------------------------------------

export type StockOperationStatus = "DRAFT" | "PENDING" | "READY" | "DONE" | "CANCELLED";

export interface StockOperationItem {
  id: string;
  quantity: number;
  doneQuantity: number;
  unitCost: string;
  product: { id: string; name: string; skuCode: string | null };
  variant: { id: string; name: string; skuCode: string } | null;
}

export interface StockOperation {
  id: string;
  operationNumber: string;
  status: StockOperationStatus;
  reference: string | null;
  notes: string | null;
  createdAt: string;
  executedAt: string | null;
  operationType: {
    id: string;
    name: string;
    code: string;
    requiresValidation: boolean;
  };
  fromWarehouse: Ref | null;
  toWarehouse: Ref | null;
  executedBy: { id: string; fullName: string } | null;
  items: StockOperationItem[];
}

export interface StockOperationItemInput {
  productId: string;
  variantId?: string | null;
  quantity: number;
  unitCost?: number;
}

export interface CreateStockOperationInput {
  operationTypeId: string;
  fromWarehouseId?: string | null;
  toWarehouseId?: string | null;
  reference?: string | null;
  notes?: string | null;
  items: StockOperationItemInput[];
}

export interface StockOperationFilter extends ListQuery {
  status?: StockOperationStatus;
  operationTypeId?: string;
  warehouseId?: string;
}

// ---------------------------------------------------------------------------
// Stock counts
// ---------------------------------------------------------------------------

export type StockCountStatus = "DRAFT" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";

export interface StockCountItem {
  id: string;
  systemQuantity: number;
  countedQuantity: number | null;
  variance: number | null;
  product: { id: string; name: string; skuCode: string | null };
  storageLocation: { id: string; name: string };
}

export interface StockCount {
  id: string;
  referenceNumber: string;
  status: StockCountStatus;
  reason: string | null;
  notes: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  warehouse: Ref | null;
  storageLocation: { id: string; name: string } | null;
  items: StockCountItem[];
}

export interface CreateStockCountInput {
  warehouseId?: string | null;
  storageLocationId?: string | null;
  reason?: string | null;
  notes?: string | null;
  /** Omit to count every product with stock in scope. */
  productIds?: string[];
}

export interface CountedItemInput {
  productId: string;
  storageLocationId: string;
  countedQuantity: number;
}

export interface StockCountFilter extends ListQuery {
  status?: StockCountStatus;
  warehouseId?: string;
}

// ---------------------------------------------------------------------------
// Reorder points
// ---------------------------------------------------------------------------

export interface ReorderPoint {
  id: string;
  minStockLevel: number;
  maxStockLevel: number;
  reorderQuantity: number;
  product: { id: string; name: string; skuCode: string | null };
  warehouse: Ref;
}

export interface CreateReorderPointInput {
  productId: string;
  warehouseId: string;
  minStockLevel?: number;
  maxStockLevel?: number;
  reorderQuantity?: number;
}

export type UpdateReorderPointInput = Partial<Omit<CreateReorderPointInput, "productId" | "warehouseId">>;

export interface ReorderPointFilter extends ListQuery {
  productId?: string;
  warehouseId?: string;
}

export const inventoryApi = {
  // Warehouses — bare array.
  listWarehouses: (query: ListQuery = {}) => http.get<Warehouse[]>("/inventory/warehouses", query),
  createWarehouse: (input: CreateWarehouseInput) => http.post<Warehouse>("/inventory/warehouses", input),
  updateWarehouse: (id: string, input: UpdateWarehouseInput) =>
    http.patch<Warehouse>(`/inventory/warehouses/${id}`, input),
  deleteWarehouse: (id: string) => http.delete<void>(`/inventory/warehouses/${id}`),

  // Storage locations — bare array.
  listStorageLocations: (query: StorageLocationFilter = {}) =>
    http.get<StorageLocation[]>("/inventory/storage-locations", query),
  createStorageLocation: (input: CreateStorageLocationInput) =>
    http.post<StorageLocation>("/inventory/storage-locations", input),
  updateStorageLocation: (id: string, input: UpdateStorageLocationInput) =>
    http.patch<StorageLocation>(`/inventory/storage-locations/${id}`, input),
  deleteStorageLocation: (id: string) => http.delete<void>(`/inventory/storage-locations/${id}`),

  // Operation types — bare array.
  listOperationTypes: (query: ListQuery = {}) =>
    http.get<OperationType[]>("/inventory/operation-types", query),
  createOperationType: (input: CreateOperationTypeInput) =>
    http.post<OperationType>("/inventory/operation-types", input),
  updateOperationType: (id: string, input: UpdateOperationTypeInput) =>
    http.patch<OperationType>(`/inventory/operation-types/${id}`, input),
  deleteOperationType: (id: string) => http.delete<void>(`/inventory/operation-types/${id}`),

  // Stock: the balances, and the ledger that explains them.
  listStockLevels: (query: StockFilter = {}) =>
    http.get<Page<StockLevel>>("/inventory/stock/levels", query),
  listStockTransactions: (query: StockFilter = {}) =>
    http.get<Page<InventoryTransaction>>("/inventory/stock/transactions", query),
  adjustStock: (input: AdjustStockInput) =>
    http.post<InventoryTransaction>("/inventory/stock/adjust", input),
  transferStock: (input: TransferStockInput) =>
    http.post<{ moved: number }>("/inventory/stock/transfer", input),

  // Stock operations (planned movements).
  listStockOperations: (query: StockOperationFilter = {}) =>
    http.get<Page<StockOperation>>("/inventory/operations", query),
  createStockOperation: (input: CreateStockOperationInput) =>
    http.post<StockOperation>("/inventory/operations", input),
  executeStockOperation: (id: string) =>
    http.post<StockOperation>(`/inventory/operations/${id}/execute`),
  cancelStockOperation: (id: string) =>
    http.post<StockOperation>(`/inventory/operations/${id}/cancel`),

  // Stock counts.
  listStockCounts: (query: StockCountFilter = {}) =>
    http.get<Page<StockCount>>("/inventory/counts", query),
  getStockCount: (id: string) => http.get<StockCount>(`/inventory/counts/${id}`),
  createStockCount: (input: CreateStockCountInput) => http.post<StockCount>("/inventory/counts", input),
  startStockCount: (id: string) => http.post<StockCount>(`/inventory/counts/${id}/start`),
  recordStockCount: (id: string, items: CountedItemInput[]) =>
    http.post<StockCount>(`/inventory/counts/${id}/items`, { items }),
  completeStockCount: (id: string) => http.post<StockCount>(`/inventory/counts/${id}/complete`),
  cancelStockCount: (id: string) => http.post<StockCount>(`/inventory/counts/${id}/cancel`),

  // Reorder points — bare array.
  listReorderPoints: (query: ReorderPointFilter = {}) =>
    http.get<ReorderPoint[]>("/inventory/reorder-points", query),
  createReorderPoint: (input: CreateReorderPointInput) =>
    http.post<ReorderPoint>("/inventory/reorder-points", input),
  updateReorderPoint: (id: string, input: UpdateReorderPointInput) =>
    http.patch<ReorderPoint>(`/inventory/reorder-points/${id}`, input),
};
