import { http, type Page } from "./http";
import type { ListQuery } from "./catalog";

// Purchasing: who the company buys from, and what it has ordered.

export type VendorKind = "SUPPLIER" | "CONSIGNMENT";

export interface Vendor {
  id: string;
  kind: VendorKind;
  name: string;
  contactPerson: string;
  phoneNumber: string;
  email: string;
  address: string;
  taxNumber: string | null;
  notes: string;
  isActive: boolean;
  /** Decimal on the server, so a string on the wire. */
  commissionRate: string;
  createdAt: string;
  _count: { purchaseOrders: number };
}

export interface CreateVendorInput {
  kind?: VendorKind;
  name: string;
  contactPerson?: string;
  phoneNumber?: string;
  email?: string;
  address?: string;
  taxNumber?: string | null;
  notes?: string;
  isActive?: boolean;
  commissionRate?: number;
}

export type UpdateVendorInput = Partial<CreateVendorInput>;

export interface VendorFilter extends ListQuery {
  kind?: VendorKind;
  isActive?: boolean;
}

// ---------------------------------------------------------------------------
// Purchase orders
// ---------------------------------------------------------------------------

export type PurchaseOrderStatus =
  | "DRAFT"
  | "ORDERED"
  | "PARTIALLY_RECEIVED"
  | "RECEIVED"
  | "CANCELLED";

export interface PurchaseOrderItem {
  id: string;
  /** Snapshot at the time of ordering: the product may be renamed later. */
  productName: string;
  skuCode: string | null;
  quantity: number;
  receivedQuantity: number;
  unitPrice: string;
  total: string;
  product: { id: string; name: string; skuCode: string | null } | null;
}

export interface PurchaseOrderListItem {
  id: string;
  orderNumber: string;
  status: PurchaseOrderStatus;
  totalAmount: string;
  notes: string;
  expectedAt: string | null;
  receivedAt: string | null;
  createdAt: string;
  vendor: { id: string; name: string; kind: VendorKind };
  _count: { items: number };
}

export interface PurchaseOrder extends PurchaseOrderListItem {
  cancelledAt: string | null;
  items: PurchaseOrderItem[];
}

export interface PurchaseOrderItemInput {
  productId: string;
  quantity: number;
  unitPrice?: number;
}

export interface CreatePurchaseOrderInput {
  vendorId: string;
  notes?: string;
  expectedAt?: string | null;
  items: PurchaseOrderItemInput[];
}

export interface UpdatePurchaseOrderInput {
  status?: PurchaseOrderStatus;
  notes?: string;
  expectedAt?: string | null;
  items?: PurchaseOrderItemInput[];
}

export interface ReceivedItemInput {
  productId: string;
  quantity: number;
}

export interface PurchaseOrderFilter extends ListQuery {
  status?: PurchaseOrderStatus;
  vendorId?: string;
}

export const purchasingApi = {
  // Vendors.
  listVendors: (query: VendorFilter = {}) => http.get<Page<Vendor>>("/purchasing/vendors", query),
  createVendor: (input: CreateVendorInput) => http.post<Vendor>("/purchasing/vendors", input),
  updateVendor: (id: string, input: UpdateVendorInput) =>
    http.patch<Vendor>(`/purchasing/vendors/${id}`, input),
  deleteVendor: (id: string) => http.delete<void>(`/purchasing/vendors/${id}`),

  // Purchase orders.
  listPurchaseOrders: (query: PurchaseOrderFilter = {}) =>
    http.get<Page<PurchaseOrderListItem>>("/purchasing/purchase-orders", query),
  getPurchaseOrder: (id: string) => http.get<PurchaseOrder>(`/purchasing/purchase-orders/${id}`),
  createPurchaseOrder: (input: CreatePurchaseOrderInput) =>
    http.post<PurchaseOrder>("/purchasing/purchase-orders", input),
  updatePurchaseOrder: (id: string, input: UpdatePurchaseOrderInput) =>
    http.patch<PurchaseOrder>(`/purchasing/purchase-orders/${id}`, input),
  receivePurchaseOrderItems: (id: string, items: ReceivedItemInput[]) =>
    http.post<PurchaseOrder>(`/purchasing/purchase-orders/${id}/receive`, { items }),
  deletePurchaseOrder: (id: string) => http.delete<void>(`/purchasing/purchase-orders/${id}`),
};
