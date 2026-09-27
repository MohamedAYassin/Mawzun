import { http, type Page } from "./http";

// The catalogue: what the company sells and how it is grouped.
//
// Money and percentage columns are Postgres `numeric`, which Prisma surfaces as
// Decimal and JSON serialises as a **string**. They are typed `string` here on
// purpose — declaring them `number` would compile and then produce NaN the
// first time a price was added to another price.

/** `{ id, name }`, the shape of every dropdown in the app. */
export interface Ref {
  id: string;
  name: string;
}

/** A shared list query. Every paginated endpoint accepts these. */
export interface ListQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  sortBy?: string;
  sortDir?: "asc" | "desc";
  includeDeleted?: boolean;
}

// ---------------------------------------------------------------------------
// Brands
// ---------------------------------------------------------------------------

export interface Brand {
  id: string;
  name: string;
  slug: string | null;
  description: string | null;
  logoUrl: string | null;
  isActive: boolean;
  createdAt: string;
  _count: { products: number };
}

export interface CreateBrandInput {
  name: string;
  description?: string | null;
  logoUrl?: string | null;
  isActive?: boolean;
}

export type UpdateBrandInput = Partial<CreateBrandInput>;

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export interface Category {
  id: string;
  name: string;
  slug: string | null;
  description: string | null;
  imageUrl: string | null;
  parentId: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  _count: { products: number; children: number };
}

export interface CreateCategoryInput {
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  parentId?: string | null;
  isActive?: boolean;
  sortOrder?: number;
}

export type UpdateCategoryInput = Partial<CreateCategoryInput>;

// ---------------------------------------------------------------------------
// Units of measure
// ---------------------------------------------------------------------------

export interface Uom {
  id: string;
  code: string;
  name: string;
  category: string;
  isActive: boolean;
  createdAt: string;
}

export interface CreateUomInput {
  code: string;
  name: string;
  category?: string;
  isActive?: boolean;
}

export type UpdateUomInput = Partial<CreateUomInput>;

// ---------------------------------------------------------------------------
// Tax rates
// ---------------------------------------------------------------------------

export interface TaxRate {
  id: string;
  name: string;
  /** Decimal on the server, so a string on the wire. */
  percentage: string;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Attributes (variation axes such as size or colour) and their values
// ---------------------------------------------------------------------------

export type AttributeType = "TEXT" | "SELECT" | "COLOR";

export interface ProductAttribute {
  id: string;
  name: string;
  code: string;
  type: AttributeType;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  _count: { values: number };
}

export interface CreateAttributeInput {
  name: string;
  code: string;
  type?: AttributeType;
  isActive?: boolean;
  sortOrder?: number;
}

export type UpdateAttributeInput = Partial<CreateAttributeInput>;

export interface AttributeValue {
  id: string;
  value: string;
  colorHex: string | null;
  skuSuffix: string | null;
  barcode: string | null;
  sortOrder: number;
  isActive: boolean;
}

export interface CreateAttributeValueInput {
  value: string;
  colorHex?: string | null;
  skuSuffix?: string | null;
  barcode?: string | null;
  sortOrder?: number;
  isActive?: boolean;
}

export type UpdateAttributeValueInput = Partial<CreateAttributeValueInput>;

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export interface ProductVariant {
  id: string;
  name: string;
  skuCode: string;
  barcode: string | null;
  price: string;
  costPrice: string;
  imageUrl: string | null;
  isActive: boolean;
  attributes: {
    value: {
      id: string;
      value: string;
      colorHex: string | null;
      attribute: { id: string; name: string; code: string };
    };
  }[];
}

export interface ProductImage {
  id: string;
  imageUrl: string;
  altText: string | null;
  sortOrder: number;
  isPrimary: boolean;
}

export interface ProductStockLevel {
  onHand: number;
  reserved: number;
  storageLocation: {
    id: string;
    name: string;
    warehouse: { id: string; name: string };
  };
}

export interface ProductListItem {
  id: string;
  name: string;
  slug: string;
  skuCode: string | null;
  barcode: string | null;
  price: string;
  priceBeforeDiscount: string | null;
  costPrice: string;
  isActive: boolean;
  trackStock: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  category: Ref | null;
  brand: Ref | null;
  uom: { id: string; code: string; name: string } | null;
  /** Flattened from the primary image by the list endpoint. */
  primaryImage: string | null;
  onHand: number;
  reserved: number;
  available: number;
  _count: { variants: number };
}

export interface Product extends Omit<ProductListItem, "primaryImage"> {
  description: string | null;
  weightKg: number | null;
  trackExpiry: boolean;
  deletedAt: string | null;
  salesTaxRate: { id: string; name: string; percentage: string } | null;
  purchaseTaxRate: { id: string; name: string; percentage: string } | null;
  images: ProductImage[];
  variants: ProductVariant[];
  stockLevels: ProductStockLevel[];
}

export interface ProductImageInput {
  imageUrl: string;
  altText?: string | null;
  isPrimary?: boolean;
  sortOrder?: number;
}

export interface ProductVariantInput {
  name: string;
  skuCode: string;
  barcode?: string | null;
  price?: number;
  costPrice?: number;
  imageUrl?: string | null;
  isActive?: boolean;
  valueIds?: string[];
}

export interface CreateProductInput {
  name: string;
  description?: string | null;
  skuCode?: string | null;
  barcode?: string | null;
  isActive?: boolean;
  categoryId?: string | null;
  brandId?: string | null;
  uomId?: string | null;
  salesTaxRateId?: string | null;
  purchaseTaxRateId?: string | null;
  price?: number;
  priceBeforeDiscount?: number | null;
  costPrice?: number;
  weightKg?: number | null;
  trackStock?: boolean;
  trackExpiry?: boolean;
  images?: ProductImageInput[];
  variants?: ProductVariantInput[];
}

export interface UpdateProductInput extends Partial<CreateProductInput> {
  archived?: boolean;
}

export interface ListProductsQuery extends ListQuery {
  categoryId?: string;
  brandId?: string;
  isActive?: boolean;
  archived?: "true" | "false" | "all";
  lowStockOnly?: boolean;
  lowStockThreshold?: number;
}

// ---------------------------------------------------------------------------
// Product merges
// ---------------------------------------------------------------------------

export type MergeStatus = "PENDING" | "EXECUTED" | "CANCELLED";

export interface ProductMerge {
  id: string;
  status: MergeStatus;
  reason: string | null;
  createdAt: string;
  /** Set when the merge is executed; null while it is still only planned. */
  mergedAt: string | null;
  sourceProduct: { id: string; name: string; skuCode: string | null };
  targetProduct: { id: string; name: string; skuCode: string | null };
}

export interface CreateMergeInput {
  sourceProductId: string;
  targetProductId: string;
  reason?: string | null;
}

export const catalogApi = {
  // Brands — paginated.
  listBrands: (query: ListQuery = {}) => http.get<Page<Brand>>("/catalog/brands", query),
  createBrand: (input: CreateBrandInput) => http.post<Brand>("/catalog/brands", input),
  updateBrand: (id: string, input: UpdateBrandInput) =>
    http.patch<Brand>(`/catalog/brands/${id}`, input),
  deleteBrand: (id: string) => http.delete<void>(`/catalog/brands/${id}`),

  // Categories — paginated.
  listCategories: (query: ListQuery = {}) => http.get<Page<Category>>("/catalog/categories", query),
  createCategory: (input: CreateCategoryInput) => http.post<Category>("/catalog/categories", input),
  updateCategory: (id: string, input: UpdateCategoryInput) =>
    http.patch<Category>(`/catalog/categories/${id}`, input),
  deleteCategory: (id: string) => http.delete<void>(`/catalog/categories/${id}`),

  // Units of measure — a short reference list, so the endpoint returns a bare
  // array rather than a page.
  listUoms: (query: ListQuery = {}) => http.get<Uom[]>("/catalog/uoms", query),
  createUom: (input: CreateUomInput) => http.post<Uom>("/catalog/uoms", input),
  updateUom: (id: string, input: UpdateUomInput) => http.patch<Uom>(`/catalog/uoms/${id}`, input),
  deleteUom: (id: string) => http.delete<void>(`/catalog/uoms/${id}`),

  // Tax rates — bare array.
  listTaxRates: (query: ListQuery = {}) => http.get<TaxRate[]>("/catalog/tax-rates", query),

  // Attributes — bare array.
  listAttributes: (query: ListQuery = {}) => http.get<ProductAttribute[]>("/catalog/attributes", query),
  createAttribute: (input: CreateAttributeInput) =>
    http.post<ProductAttribute>("/catalog/attributes", input),
  updateAttribute: (id: string, input: UpdateAttributeInput) =>
    http.patch<ProductAttribute>(`/catalog/attributes/${id}`, input),
  deleteAttribute: (id: string) => http.delete<void>(`/catalog/attributes/${id}`),

  // Attribute values — nested under their attribute, because a value has no
  // meaning without the axis it sits on.
  listAttributeValues: (attributeId: string, query: ListQuery = {}) =>
    http.get<AttributeValue[]>(`/catalog/attributes/${attributeId}/values`, query),
  createAttributeValue: (attributeId: string, input: CreateAttributeValueInput) =>
    http.post<AttributeValue>(`/catalog/attributes/${attributeId}/values`, input),
  updateAttributeValue: (attributeId: string, valueId: string, input: UpdateAttributeValueInput) =>
    http.patch<AttributeValue>(`/catalog/attributes/${attributeId}/values/${valueId}`, input),
  deleteAttributeValue: (attributeId: string, valueId: string) =>
    http.delete<void>(`/catalog/attributes/${attributeId}/values/${valueId}`),

  // Products.
  listProducts: (query: ListProductsQuery = {}) =>
    http.get<Page<ProductListItem>>("/catalog/products", query),
  getProduct: (id: string) => http.get<Product>(`/catalog/products/${id}`),
  createProduct: (input: CreateProductInput) => http.post<Product>("/catalog/products", input),
  updateProduct: (id: string, input: UpdateProductInput) =>
    http.patch<Product>(`/catalog/products/${id}`, input),
  deleteProduct: (id: string) => http.delete<void>(`/catalog/products/${id}`),
  archiveProduct: (id: string) => http.post<Product>(`/catalog/products/${id}/archive`),
  unarchiveProduct: (id: string) => http.post<Product>(`/catalog/products/${id}/unarchive`),

  // Product images — nested under the product they belong to.
  /** Uploads a file to R2 and registers the returned public URL as an image. */
  uploadProductImage: (productId: string, file: File, opts: { altText?: string; isPrimary?: boolean } = {}) => {
    const form = new FormData();
    form.append("file", file);
    if (opts.altText) form.append("altText", opts.altText);
    if (opts.isPrimary !== undefined) form.append("isPrimary", String(opts.isPrimary));
    return http.upload<ProductImage>(`/catalog/products/${productId}/images/upload`, form);
  },

  // Merges.
  listMerges: (query: ListQuery = {}) => http.get<Page<ProductMerge>>("/catalog/merges", query),
  createMerge: (input: CreateMergeInput) => http.post<ProductMerge>("/catalog/merges", input),
  executeMerge: (id: string) => http.post<ProductMerge>(`/catalog/merges/${id}/execute`),
  cancelMerge: (id: string) => http.post<ProductMerge>(`/catalog/merges/${id}/cancel`),
};
