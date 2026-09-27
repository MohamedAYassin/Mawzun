import { http, type Page } from "./http";
import type { ListQuery } from "./catalog";
import type { OrderStatus } from "./sales";

// Production: turning components into sellable goods, and the two planning
// views that say what should be made next.

export type ProductionBatchStatus =
  | "DRAFT"
  | "PLANNED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELLED";

export interface ProductionBatchItem {
  id: string;
  quantity: number;
  producedQuantity: number;
  unitCost: string;
  notes: string | null;
  product: { id: string; name: string; skuCode: string | null };
}

export interface ProductionBatchListItem {
  id: string;
  batchNumber: string;
  status: ProductionBatchStatus;
  notes: string;
  startDate: string | null;
  completionDate: string | null;
  cancelledAt: string | null;
  createdAt: string;
  _count: { items: number; orders: number };
}

export interface ProductionBatch extends ProductionBatchListItem {
  updatedAt: string;
  items: ProductionBatchItem[];
  orders: {
    id: string;
    orderNumber: string;
    status: OrderStatus;
    hasShortage: boolean;
    createdAt: string;
    customer: { id: string; name: string; phoneNumber1: string };
    _count: { items: number };
  }[];
}

export interface ProductionBatchItemInput {
  productId: string;
  quantity: number;
  unitCost?: number;
  notes?: string | null;
}

export interface CreateProductionBatchInput {
  notes?: string;
  startDate?: string | null;
  /** Orders this run covers. Their lines are aggregated into the batch. */
  orderIds?: string[];
  /** Explicit lines, for a run that is not tied to specific orders. */
  items?: ProductionBatchItemInput[];
}

export interface UpdateProductionBatchInput {
  notes?: string;
  startDate?: string | null;
  status?: ProductionBatchStatus;
  orderIds?: string[];
  items?: ProductionBatchItemInput[];
}

export interface ProductionBatchFilter extends ListQuery {
  status?: ProductionBatchStatus;
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

export interface DeficitLine {
  productId: string;
  productName: string;
  skuCode: string | null;
  warehouseId: string;
  warehouseName: string;
  minStockLevel: number;
  maxStockLevel: number;
  reorderQuantity: number;
  availableQuantity: number;
  deficit: number;
}

export const productionApi = {
  listBatches: (query: ProductionBatchFilter = {}) =>
    http.get<Page<ProductionBatchListItem>>("/production/batches", query),
  getBatch: (id: string) => http.get<ProductionBatch>(`/production/batches/${id}`),
  createBatch: (input: CreateProductionBatchInput) =>
    http.post<ProductionBatch>("/production/batches", input),
  updateBatch: (id: string, input: UpdateProductionBatchInput) =>
    http.patch<ProductionBatch>(`/production/batches/${id}`, input),
  startBatch: (id: string) => http.post<ProductionBatch>(`/production/batches/${id}/start`),
  completeBatch: (id: string) => http.post<ProductionBatch>(`/production/batches/${id}/complete`),
  cancelBatch: (id: string) => http.post<ProductionBatch>(`/production/batches/${id}/cancel`),
  deleteBatch: (id: string) => http.delete<void>(`/production/batches/${id}`),

  // Planning views.
  /** Products below their reorder point, per warehouse. */
  deficits: (warehouseId?: string) =>
    http.get<Page<DeficitLine>>("/production/planning/deficits", { warehouseId }),
};
