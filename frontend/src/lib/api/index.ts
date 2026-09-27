// Domain API clients.
//
// Each domain gets a client here against the current `/api/v1` contract. The
// single monolithic module that mixed every domain and spoke the pre-refactor
// contract the backend no longer serves is gone; every caller has moved across.
//
// Shared transport lives in ./http and is the only place that knows about
// fetch, tokens and the response envelope.

export * from "./http";
export { authApi } from "./auth";
export type {
  AuthResult,
  AuthTokens,
  ChangePasswordInput,
  CompanySummary,
  LoginInput,
  Principal,
  SignupInput,
  UserSummary,
} from "./auth";

export { companyApi, platformApi, BLOCKING_STATUSES } from "./company";
export type {
  CompanyDirectoryEntry,
  CompanyIdentity,
  CompanyProfile,
  CompanyStatus,
  CompanyStatusChange,
  ListCompaniesQuery,
  UpdateCompanyInput,
} from "./company";

export { usersApi } from "./users";
export type {
  CompanyUser,
  CreateUserInput,
  ListUsersQuery,
  RoleKind,
  UpdateUserInput,
  UserRoleRef,
  UserStatus,
} from "./users";

export { rolesApi } from "./roles";
export type { CreateRoleInput, ListRolesQuery, Role, UpdateRoleInput } from "./roles";

export { settingsApi } from "./settings";
export { onboardingApi, ONBOARDING_STEPS } from "./onboarding";
export type { BusinessType, CompleteOnboardingInput, OnboardingStatus, OnboardingStep } from "./onboarding";
export type { CompanySettings, StockCommitPoint, UpdateSettingsInput } from "./settings";

export { catalogApi } from "./catalog";
export type {
  AttributeType,
  AttributeValue,
  Brand,
  Category,
  CreateAttributeInput,
  CreateAttributeValueInput,
  CreateBrandInput,
  CreateCategoryInput,
  CreateProductInput,
  CreateUomInput,
  ListProductsQuery,
  ListQuery,
  MergeStatus,
  Product,
  ProductAttribute,
  ProductImage,
  ProductImageInput,
  ProductListItem,
  ProductMerge,
  ProductStockLevel,
  ProductVariant,
  ProductVariantInput,
  Ref,
  TaxRate,
  UpdateProductInput,
  Uom,
} from "./catalog";

export { inventoryApi } from "./inventory";
export type {
  AdjustStockInput,
  CreateReorderPointInput,
  CreateStockCountInput,
  CreateStockOperationInput,
  CreateStorageLocationInput,
  CreateWarehouseInput,
  InventoryTransaction,
  OperationType,
  ReorderPoint,
  StockCount,
  StockCountItem,
  StockCountStatus,
  StockFilter,
  StockOperationStatus,
  StockLevel,
  StockOperation,
  StockOperationFilter,
  StockOperationItem,
  StorageLocation,
  TransferStockInput,
  Warehouse,
} from "./inventory";

export { salesApi } from "./sales";
export type {
  CreateCustomerInput,
  CreateOrderInput,
  Coupon,
  CustomerOrder,
  CouponInput,
  OrderInvoice,
  OrderConfigEntry,
  Customer,
  FulfillmentBatch,
  FulfillmentBatchFilter,
  FulfillmentBatchStatus,
  FulfillmentBatchType,
  Order,
  OrderFilter,
  OrderItem,
  OrderListItem,
  OrderStatus,
  OrderType,
  ShippingReturn,
} from "./sales";

export { purchasingApi } from "./purchasing";
export type {
  CreatePurchaseOrderInput,
  CreateVendorInput,
  PurchaseOrder,
  PurchaseOrderListItem,
  PurchaseOrderStatus,
  Vendor,
  VendorKind,
} from "./purchasing";

export { productionApi } from "./production";
export type {
  CreateProductionBatchInput,
  DeficitLine,
  ProductionBatch,
  ProductionBatchListItem,
  ProductionBatchStatus,
} from "./production";

export { shippingApi } from "./shipping";
export type {
  Carrier,
  CarrierType,
  City,
  Country,
  CreateCarrierInput,
  CreateRegionInput,
  Governorate,
} from "./shipping";

export { sessionsApi } from "./sessions";
export type { ActiveSession, SessionList } from "./sessions";

export { systemApi } from "./system";
export type {
  ApiKey,
  CreateApiKeyInput,
  CreateStoreInput,
  Notification,
  NotificationCategory,
  Store,
  StorePlatform,
  SyncError,
  SyncErrorStatus,
} from "./system";

export { reportsApi } from "./reports";
export type {
  DateRange,
  GraphPoint,
  InventoryOverview,
  OrderGraph,
  OrderTotals,
  OrdersOverview,
  ProductOverview,
  PurchasesOverview,
  ShippingOverview,
  CarrierCost,
  CarrierSpeed,
  CarrierStat,
  CarrierSuccess,
  CarrierUsage,
  CitySuccessRate,
  ProductConfirmation,
  StatusDistribution,
  StockReportRow,
  LocationStockRow,
  TopCategory,
  TopEmployee,
  TopProduct,
  TopReturnReason,
} from "./reports";
