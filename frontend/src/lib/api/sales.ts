import { http, type Page } from "./http";
import type { ListQuery, Ref } from "./catalog";

// Sales: customers, orders, and the reference data an order is built from.
//
// Order status is a string enum now, not a number. The old contract passed
// integers and kept a lookup table on both sides; the lookup drifted, so an
// order could be shown as "Delivered" while the server thought it was
// "Returned". The literal is the contract.

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export interface Customer {
  id: string;
  name: string;
  phoneNumber1: string;
  phoneNumber2: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  _count: { orders: number };
}

export interface CreateCustomerInput {
  name: string;
  phoneNumber1: string;
  phoneNumber2?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
  isActive?: boolean;
}

export type UpdateCustomerInput = Partial<CreateCustomerInput>;

/** POST /sales/customers/find-or-create returns the customer plus whether it was newly created. */
export interface FindOrCreateCustomerResult {
  customer: Customer;
  created: boolean;
}

export interface CustomerFilter extends ListQuery {
  isActive?: boolean;
}

export interface CustomerOrder {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  orderPrice: string;
  orderActualPrice: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export type OrderType = "SALE" | "RETURN" | "EXCHANGE";

export type OrderStatus =
  | "NEW"
  | "CONFIRMED"
  | "POSTPONED"
  | "CANCELLED"
  | "NO_ANSWER"
  | "DELIVERED"
  | "RETURNED"
  | "NOT_DELIVERED"
  | "ON_THE_WAY"
  | "RETURNED_TO_WAREHOUSE";

export interface OrderItem {
  id: string;
  quantity: number;
  confirmedQuantity: number;
  unitPrice: string;
  unitCost: string;
  itemDiscountPercentage: string;
  itemDiscountAmount: string;
  discountType: "PERCENTAGE" | "FIXED";
  needsManufacturing: boolean;
  product: {
    id: string;
    name: string;
    skuCode: string | null;
    images: { imageUrl: string }[];
  };
}

export interface OrderListItem {
  id: string;
  orderNumber: string;
  type: OrderType;
  status: OrderStatus;
  shippingCost: string;
  discountPercentage: string;
  couponCode: string | null;
  currencyCode: string;
  orderPrice: string;
  orderActualPrice: string;
  hasShortage: boolean;
  createdAt: string;
  confirmedAt: string | null;
  deliveredAt: string | null;
  customer: { id: string; name: string; phoneNumber1: string };
  carrier: Ref | null;
  orderSource: Ref | null;
  paymentMethod: Ref | null;
  city: Ref | null;
  shippingGovernorate: Ref | null;
  warehouse: Ref | null;
  _count: { items: number };
}

export interface Order extends OrderListItem {
  externalId: string | null;
  externalNumber: string | null;
  detailedAddress: string | null;
  notes: string | null;
  cancelledAt: string | null;
  shippedAt: string | null;
  updatedAt: string;
  cancelReason: Ref | null;
  originalOrder: { id: string; orderNumber: string } | null;
  derivedOrders: { id: string; orderNumber: string; type: OrderType; status: OrderStatus }[];
  productionBatch: { id: string; batchNumber: string } | null;
  items: OrderItem[];
}

export interface OrderItemInput {
  productId: string;
  variantId?: string | null;
  quantity: number;
  unitPrice?: number;
  unitCost?: number;
  itemDiscountPercentage?: number;
  itemDiscountAmount?: number;
  discountType?: "PERCENTAGE" | "FIXED";
  needsManufacturing?: boolean;
}

export interface OrderInvoice {
  company: { name: string; email: string | null; phoneNumber: string | null; address: string | null };
  invoice: {
    orderNumber: string;
    date: string;
    status: string;
    currency: string;
    customerName: string;
    customerPhone: string | null;
    customerEmail: string | null;
    warehouseName: string | null;
    couponCode: string | null;
    subtotal: number;
    shippingCost: number;
    discountPercentage: number;
    discountAmount: number;
    total: number;
  };
  items: {
    productName: string;
    skuCode: string | null;
    quantity: number;
    unitPrice: number;
    discount: number;
    lineTotal: number;
  }[];
}

export interface Coupon {
  id: string;
  code: string;
  discountType: 'PERCENTAGE' | 'FIXED';
  value: number;
  minOrderTotal: number | null;
  maxRedemptions: number | null;
  redemptionCount: number;
  expiresAt: string | null;
  isActive: boolean;
  createdAt: string;
  _count: { orders: number };
}

export interface CouponInput {
  code: string;
  discountType?: 'PERCENTAGE' | 'FIXED';
  value: number;
  minOrderTotal?: number | null;
  maxRedemptions?: number | null;
  expiresAt?: string | null;
  isActive?: boolean;
}

export interface CreateOrderInput {
  customerId: string;
  type?: OrderType;
  orderSourceId?: string | null;
  paymentMethodId?: string | null;
  carrierId?: string | null;
  shippingGovernorateId?: string | null;
  cityId?: string | null;
  warehouseId?: string | null;
  cancelReasonId?: string | null;
  originalOrderId?: string | null;
  shippingCost?: number;
  discountPercentage?: number;
  couponCode?: string | null;
  detailedAddress?: string | null;
  notes?: string | null;
  items: OrderItemInput[];
}

export interface ChangeOrderStatusInput {
  status: OrderStatus;
  cancelReasonId?: string | null;
  notes?: string | null;
}

export interface OrderFilter extends ListQuery {
  status?: OrderStatus;
  type?: OrderType;
  customerId?: string;
  carrierId?: string;
  orderSourceId?: string;
  paymentMethodId?: string;
  warehouseId?: string;
  from?: string;
  to?: string;
}

// ---------------------------------------------------------------------------
// Order configuration: sources, payment methods, cancel reasons
// ---------------------------------------------------------------------------

export interface OrderConfigEntry {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: string;
}

export interface CreateOrderConfigInput {
  name: string;
  isActive?: boolean;
}

export type UpdateOrderConfigInput = Partial<CreateOrderConfigInput>;

export interface OrderConfigFilter extends ListQuery {
  isActive?: boolean;
}

// ---------------------------------------------------------------------------
// Fulfilment batches
// ---------------------------------------------------------------------------

export type FulfillmentBatchType = "PICKING" | "PACKING";

/**
 * The three states a batch can be in, as the backend defines them.
 *
 * "NEW" rather than "OPEN" is deliberate: a batch is created empty and stays
 * NEW until it is completed or cancelled. There is no in-progress state to
 * track, so inventing one here would leave the UI waiting for a transition
 * the server will never report.
 */
export type FulfillmentBatchStatus = "NEW" | "DONE" | "CANCELLED";

export interface FulfillmentBatch {
  id: string;
  name: string;
  type: FulfillmentBatchType;
  status: FulfillmentBatchStatus;
  completedAt: string | null;
  createdAt: string;
  warehouse: Ref;
}

export interface CreateFulfillmentBatchInput {
  name: string;
  warehouseId: string;
  type?: FulfillmentBatchType;
}

export interface FulfillmentBatchFilter extends ListQuery {
  type?: FulfillmentBatchType;
  status?: FulfillmentBatchStatus;
}

// ---------------------------------------------------------------------------
// Shipping returns
// ---------------------------------------------------------------------------

export interface ShippingReturn {
  id: string;
  referenceNumber: string;
  qtyReturnedGood: number;
  qtyReturnedDamaged: number;
  qtyReturnedMissing: number;
  amountTotal: string;
  shippingCost: string;
  amountWithShipping: string;
  returnsCollected: boolean;
  returnsCollectedAt: string | null;
  notes: string | null;
  createdAt: string;
  order: { id: string; orderNumber: string; status: OrderStatus };
  customer: { id: string; name: string; phoneNumber1: string } | null;
  carrier: Ref | null;
}

export interface CreateShippingReturnInput {
  orderId: string;
  carrierId?: string | null;
  customerId?: string | null;
  qtyReturnedGood?: number;
  qtyReturnedDamaged?: number;
  qtyReturnedMissing?: number;
  amountTotal?: number;
  shippingCost?: number;
  notes?: string | null;
}

export const salesApi = {
  // Customers.
  listCustomers: (query: CustomerFilter = {}) =>
    http.get<Page<Customer>>("/sales/customers", query),
  createCustomer: (input: CreateCustomerInput) => http.post<Customer>("/sales/customers", input),
  /** For the order form: reuse the customer with this phone, or make one. */
  findOrCreateCustomer: (input: CreateCustomerInput) =>
    http.post<FindOrCreateCustomerResult>("/sales/customers/find-or-create", input),
  updateCustomer: (id: string, input: UpdateCustomerInput) =>
    http.patch<Customer>(`/sales/customers/${id}`, input),
  deleteCustomer: (id: string) => http.delete<void>(`/sales/customers/${id}`),
  listCustomerOrders: (id: string) => http.get<CustomerOrder[]>(`/sales/customers/${id}/orders`),

  // Orders.
  listOrders: (query: OrderFilter = {}) => http.get<Page<OrderListItem>>("/sales/orders", query),
  getOrder: (id: string) => http.get<Order>(`/sales/orders/${id}`),
  getOrderInvoice: (id: string) => http.get<OrderInvoice>(`/sales/orders/${id}/invoice`),
  createOrder: (input: CreateOrderInput) => http.post<Order>("/sales/orders", input),
  changeOrderStatus: (id: string, input: ChangeOrderStatusInput) =>
    http.post<Order>(`/sales/orders/${id}/status`, input),
  deleteOrder: (id: string) => http.delete<void>(`/sales/orders/${id}`),

  // Coupons.
  listCoupons: (query: { search?: string; status?: string; page?: number; pageSize?: number } = {}) =>
    http.get<Page<Coupon>>("/sales/coupons", query),
  createCoupon: (input: CouponInput) => http.post<Coupon>("/sales/coupons", input),
  updateCoupon: (id: string, input: Partial<CouponInput>) => http.patch<Coupon>(`/sales/coupons/${id}`, input),
  deleteCoupon: (id: string) => http.delete<void>(`/sales/coupons/${id}`),

  // Order configuration — bare arrays, they are short lists.
  listOrderSources: (query: OrderConfigFilter = {}) =>
    http.get<OrderConfigEntry[]>("/sales/order-sources", query),
  createOrderSource: (input: CreateOrderConfigInput) =>
    http.post<OrderConfigEntry>("/sales/order-sources", input),
  updateOrderSource: (id: string, input: UpdateOrderConfigInput) =>
    http.patch<OrderConfigEntry>(`/sales/order-sources/${id}`, input),
  deleteOrderSource: (id: string) => http.delete<void>(`/sales/order-sources/${id}`),

  listPaymentMethods: (query: OrderConfigFilter = {}) =>
    http.get<OrderConfigEntry[]>("/sales/payment-methods", query),
  createPaymentMethod: (input: CreateOrderConfigInput) =>
    http.post<OrderConfigEntry>("/sales/payment-methods", input),
  updatePaymentMethod: (id: string, input: UpdateOrderConfigInput) =>
    http.patch<OrderConfigEntry>(`/sales/payment-methods/${id}`, input),
  deletePaymentMethod: (id: string) => http.delete<void>(`/sales/payment-methods/${id}`),

  listCancelReasons: (query: OrderConfigFilter = {}) =>
    http.get<OrderConfigEntry[]>("/sales/cancel-reasons", query),
  createCancelReason: (input: CreateOrderConfigInput) =>
    http.post<OrderConfigEntry>("/sales/cancel-reasons", input),
  updateCancelReason: (id: string, input: UpdateOrderConfigInput) =>
    http.patch<OrderConfigEntry>(`/sales/cancel-reasons/${id}`, input),
  deleteCancelReason: (id: string) => http.delete<void>(`/sales/cancel-reasons/${id}`),

  // Fulfilment batches.
  listFulfillmentBatches: (query: FulfillmentBatchFilter = {}) =>
    http.get<Page<FulfillmentBatch>>("/sales/fulfillment-batches", query),
  createFulfillmentBatch: (input: CreateFulfillmentBatchInput) =>
    http.post<FulfillmentBatch>("/sales/fulfillment-batches", input),
  completeFulfillmentBatch: (id: string) =>
    http.post<FulfillmentBatch>(`/sales/fulfillment-batches/${id}/complete`),
  cancelFulfillmentBatch: (id: string) =>
    http.post<FulfillmentBatch>(`/sales/fulfillment-batches/${id}/cancel`),

  // Shipping returns.
  listShippingReturns: (query: ListQuery = {}) =>
    http.get<Page<ShippingReturn>>("/sales/shipping-returns", query),
  createShippingReturn: (input: CreateShippingReturnInput) =>
    http.post<ShippingReturn>("/sales/shipping-returns", input),

  /**
   * Marks the returned money as collected — the only state transition the
   * backend offers for a return.
   *
   * A return is a record of what the carrier brought back, not a workflow: it
   * has no completion or cancellation step to drive. The client used to offer
   * both, and both were calls to routes that do not exist.
   */
  collectShippingReturn: (id: string) =>
    http.post<ShippingReturn>(`/sales/shipping-returns/${id}/collect`),
};
