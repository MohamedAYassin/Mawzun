// Permission keys. These are stored as rows against a role, so the set is
// defined here in code and never drifts from what the UI offers.
export const Permissions = {
  // Access control
  ManageUsers: "Permissions.ManageUsers",
  ManageRoles: "Permissions.ManageRoles",
  ManageSettings: "Permissions.ManageSettings",

  // Catalog
  ViewProducts: "Permissions.ViewProducts",
  CreateProduct: "Permissions.CreateProduct",
  UpdateProduct: "Permissions.UpdateProduct",
  DeleteProduct: "Permissions.DeleteProduct",
  ViewCategories: "Permissions.ViewCategories",
  CreateCategory: "Permissions.CreateCategory",
  UpdateCategory: "Permissions.UpdateCategory",
  DeleteCategory: "Permissions.DeleteCategory",
  ViewBrands: "Permissions.ViewBrands",
  CreateBrand: "Permissions.CreateBrand",
  UpdateBrand: "Permissions.UpdateBrand",
  DeleteBrand: "Permissions.DeleteBrand",
  ViewUoms: "Permissions.ViewUoms",
  ManageUoms: "Permissions.ManageUoms",

  // Inventory
  ViewWarehouses: "Permissions.ViewWarehouses",
  CreateWarehouse: "Permissions.CreateWarehouse",
  UpdateWarehouse: "Permissions.UpdateWarehouse",
  DeleteWarehouse: "Permissions.DeleteWarehouse",
  ViewStorageLocations: "Permissions.ViewStorageLocations",
  CreateStorageLocation: "Permissions.CreateStorageLocation",
  UpdateStorageLocation: "Permissions.UpdateStorageLocation",
  DeleteStorageLocation: "Permissions.DeleteStorageLocation",
  ViewInventory: "Permissions.ViewInventory",
  ManageInventory: "Permissions.ManageInventory",
  ViewStockOperations: "Permissions.ViewStockOperations",
  ManageStockOperations: "Permissions.ManageStockOperations",

  // Sales
  ViewOrders: "Permissions.ViewOrders",
  CreateOrder: "Permissions.CreateOrder",
  UpdateOrder: "Permissions.UpdateOrder",
  DeleteOrder: "Permissions.DeleteOrder",
  ChangeOrderItemPrice: "Permissions.ChangeOrderItemPrice",
  ViewCustomers: "Permissions.ViewCustomers",
  CreateCustomer: "Permissions.CreateCustomer",
  UpdateCustomer: "Permissions.UpdateCustomer",
  DeleteCustomer: "Permissions.DeleteCustomer",
  ViewFulfillment: "Permissions.ViewFulfillment",
  ManageFulfillment: "Permissions.ManageFulfillment",
  ViewShippingReturns: "Permissions.ViewShippingReturns",
  ManageShippingReturns: "Permissions.ManageShippingReturns",

  // Purchasing
  ViewVendors: "Permissions.ViewVendors",
  CreateVendor: "Permissions.CreateVendor",
  UpdateVendor: "Permissions.UpdateVendor",
  DeleteVendor: "Permissions.DeleteVendor",
  ViewPurchaseOrders: "Permissions.ViewPurchaseOrders",
  CreatePurchaseOrder: "Permissions.CreatePurchaseOrder",
  UpdatePurchaseOrder: "Permissions.UpdatePurchaseOrder",
  DeletePurchaseOrder: "Permissions.DeletePurchaseOrder",

  // Production
  ViewProductionBatches: "Permissions.ViewProductionBatches",
  CreateProductionBatch: "Permissions.CreateProductionBatch",
  UpdateProductionBatch: "Permissions.UpdateProductionBatch",
  DeleteProductionBatch: "Permissions.DeleteProductionBatch",

  // Shipping
  ViewCarriers: "Permissions.ViewCarriers",
  ManageCarriers: "Permissions.ManageCarriers",

  // System
  ViewStores: "Permissions.ViewStores",
  ManageStores: "Permissions.ManageStores",
  ViewApiKeys: "Permissions.ViewApiKeys",
  ManageApiKeys: "Permissions.ManageApiKeys",
  ViewSyncErrors: "Permissions.ViewSyncErrors",
  ManageSyncErrors: "Permissions.ManageSyncErrors",
  ViewNotifications: "Permissions.ViewNotifications",
  ViewReports: "Permissions.ViewReports",
} as const;

export type PermissionKey = (typeof Permissions)[keyof typeof Permissions];

export function getAllPermissions(): string[] {
  return Object.values(Permissions);
}

export function isPermissionKey(value: string): value is PermissionKey {
  return (Object.values(Permissions) as string[]).includes(value);
}
