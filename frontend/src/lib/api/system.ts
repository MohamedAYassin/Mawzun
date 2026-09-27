import { http, type Page } from "./http";
import type { ListQuery, Ref } from "./catalog";

// System: the parts of the product that configure it rather than run it — API
// keys, notifications, store integrations, sync errors, and image handling.

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

export interface ApiKey {
  id: string;
  name: string;
  /** Only the prefix is ever returned: the secret is shown once, at creation. */
  keyPrefix: string;
  /** Full secret — present only on the create response, never afterwards. */
  token?: string;
  isActive: boolean;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  createdBy: { id: string; fullName: string } | null;
  /** Per-key AI throttle override; null = worker env default. */
  rateLimitMax: number | null;
  rateLimitWindowMs: number | null;
}

export interface CreateApiKeyInput {
  name: string;
  expiresAt?: string | null;
  rateLimitMax?: number | null;
  rateLimitWindowMs?: number | null;
}

export interface UpdateApiKeyInput {
  name?: string;
  isActive?: boolean;
  expiresAt?: string | null;
  rateLimitMax?: number | null;
  rateLimitWindowMs?: number | null;
}

export interface ApiKeyFilter extends ListQuery {
  isActive?: boolean;
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export type NotificationCategory =
  | "GENERAL"
  | "ORDER"
  | "INVENTORY"
  | "SYSTEM";

export interface Notification {
  id: string;
  title: string;
  message: string | null;
  category: NotificationCategory;
  link: string | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationFilter extends ListQuery {
  category?: NotificationCategory;
  isRead?: boolean;
}

// ---------------------------------------------------------------------------
// Stores (integrations)
// ---------------------------------------------------------------------------

export type StorePlatform =
  | "CUSTOM"
  | "SHOPIFY";

export interface Store {
  id: string;
  name: string;
  platform: StorePlatform;
  storeUrl: string;
  isActive: boolean;
  lastSyncedAt: string | null;
  createdAt: string;
  _count: { syncErrors: number };
}

export interface CreateStoreInput {
  name: string;
  platform?: StorePlatform;
  storeUrl?: string;
  isActive?: boolean;
  shopifyAccessToken?: string;
  shopifyWebhookSecret?: string;
}

export interface ProductExportSummary {
  requested: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: { productId: string; sku: string | null; message: string }[];
}

export interface BackfillSummary {
  fetched: number;
  created: number;
  duplicates: number;
  unmappedSkus: number;
  pages: number;
  nextCursor: string | null;
  done: boolean;
}

export type UpdateStoreInput = Partial<CreateStoreInput>;

export interface StoreFilter extends ListQuery {
  platform?: StorePlatform;
  isActive?: boolean;
}

// ---------------------------------------------------------------------------
// Sync errors
// ---------------------------------------------------------------------------

export type SyncErrorStatus = "PENDING" | "RESOLVED" | "IGNORED";

export interface SyncError {
  id: string;
  storeId: string | null;
  /** Denormalised at write time so the row survives the store being removed. */
  storeName: string | null;
  errorType: string;
  externalId: string | null;
  errorMessage: string;
  status: SyncErrorStatus;
  retryCount: number;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  store: { id: string; name: string; platform: StorePlatform } | null;
}

export interface SyncErrorFilter extends ListQuery {
  status?: SyncErrorStatus;
  storeId?: string;
  errorType?: string;
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

export const systemApi = {
  // API keys.
  listApiKeys: (query: ApiKeyFilter = {}) => http.get<Page<ApiKey>>("/system/api-keys", query),
  getApiKey: (id: string) => http.get<ApiKey>(`/system/api-keys/${id}`),
  createApiKey: (input: CreateApiKeyInput) => http.post<ApiKey>("/system/api-keys", input),
  updateApiKey: (id: string, input: UpdateApiKeyInput) =>
    http.patch<ApiKey>(`/system/api-keys/${id}`, input),
  revokeApiKey: (id: string) => http.post<ApiKey>(`/system/api-keys/${id}/revoke`),
  deleteApiKey: (id: string) => http.delete<void>(`/system/api-keys/${id}`),

  // Notifications.
  listNotifications: (query: NotificationFilter = {}) =>
    http.get<Page<Notification>>("/system/notifications", query),
  unreadNotificationCount: () =>
    http.get<{ count: number }>("/system/notifications/unread-count"),
  markNotificationRead: (id: string) => http.post<Notification>(`/system/notifications/${id}/read`),
  markAllNotificationsRead: () =>
    http.post<{ updated: number }>("/system/notifications/read-all"),
  deleteNotification: (id: string) => http.delete<void>(`/system/notifications/${id}`),

  // Stores.
  listStores: (query: StoreFilter = {}) => http.get<Page<Store>>("/system/stores", query),
  createStore: (input: CreateStoreInput) => http.post<Store>("/system/stores", input),
  updateStore: (id: string, input: UpdateStoreInput) =>
    http.patch<Store>(`/system/stores/${id}`, input),
  deleteStore: (id: string) => http.delete<void>(`/system/stores/${id}`),
  backfillStore: (id: string, since?: string) =>
    http.post<BackfillSummary>(`/system/stores/${id}/backfill`, since ? { since } : {}),
  exportProductsToStore: (id: string, productIds: string[]) =>
    http.post<ProductExportSummary>(`/system/stores/${id}/export-products`, { productIds }),

  // Sync errors.
  listSyncErrors: (query: SyncErrorFilter = {}) =>
    http.get<Page<SyncError>>("/system/sync-errors", query),
  getSyncError: (id: string) => http.get<SyncError>(`/system/sync-errors/${id}`),
  retrySyncError: (id: string) => http.post<SyncError>(`/system/sync-errors/${id}/retry`),
  resolveSyncError: (id: string) => http.post<SyncError>(`/system/sync-errors/${id}/resolve`),
  ignoreSyncError: (id: string) => http.post<SyncError>(`/system/sync-errors/${id}/ignore`),
  resolveAllSyncErrors: () => http.post<{ updated: number }>("/system/sync-errors/resolve-all"),

};

export type { Ref };
