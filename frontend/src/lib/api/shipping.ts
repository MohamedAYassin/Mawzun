import { http, type Page } from "./http";
import type { ListQuery } from "./catalog";

// Shipping: carriers, and the geography that decides what delivery costs.
//
// Governorate and city both carry a `shippingCost`. A city may leave its own at
// zero to inherit the governorate's — the server resolves that, so the client
// never has to know which of the two it is looking at.

export type CarrierType = "INTEGRATED" | "MANUAL";

export interface Carrier {
  id: string;
  name: string;
  code: string;
  type: CarrierType;
  isActive: boolean;
  logoUrl: string | null;
  trackingUrlTemplate: string | null;
  defaultShippingCost: string;
  defaultCustomerShippingCost: string;
  returnShippingCost: string;
  autoSendOrderEnabled: boolean;
  createdAt: string;
  _count: { orders: number };
}

export interface CreateCarrierInput {
  name: string;
  code: string;
  type?: CarrierType;
  isActive?: boolean;
  logoUrl?: string | null;
  trackingUrlTemplate?: string | null;
  defaultShippingCost?: number;
  defaultCustomerShippingCost?: number;
  returnShippingCost?: number;
  autoSendOrderEnabled?: boolean;
}

export type UpdateCarrierInput = Partial<CreateCarrierInput>;

export interface CarrierFilter extends ListQuery {
  type?: CarrierType;
  isActive?: boolean;
}

export interface Governorate {
  id: string;
  name: string;
  code: string | null;
  shippingCost: string;
  isActive: boolean;
  createdAt: string;
  _count: { cities: number };
}

export interface City {
  id: string;
  name: string;
  code: string | null;
  shippingCost: string;
  isActive: boolean;
  governorateId: string;
  createdAt: string;
  governorate: { id: string; name: string; shippingCost: string };
}

export interface CreateRegionInput {
  name: string;
  code?: string | null;
  shippingCost?: number;
  isActive?: boolean;
}

export type UpdateRegionInput = Partial<CreateRegionInput>;

export interface RegionFilter extends ListQuery {
  isActive?: boolean;
}

export interface Country {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  phoneCode: string | null;
  currencyCode: string | null;
  isActive: boolean;
}

export const shippingApi = {
  // Carriers — paginated.
  listCarriers: (query: CarrierFilter = {}) => http.get<Page<Carrier>>("/shipping/carriers", query),
  createCarrier: (input: CreateCarrierInput) => http.post<Carrier>("/shipping/carriers", input),
  updateCarrier: (id: string, input: UpdateCarrierInput) =>
    http.patch<Carrier>(`/shipping/carriers/${id}`, input),
  deleteCarrier: (id: string) => http.delete<void>(`/shipping/carriers/${id}`),

  // Governorates — paginated like the other reference resources.
  listGovernorates: (query: RegionFilter = {}) =>
    http.get<Page<Governorate>>("/shipping/governorates", query),
  createGovernorate: (input: CreateRegionInput) =>
    http.post<Governorate>("/shipping/governorates", input),
  updateGovernorate: (id: string, input: UpdateRegionInput) =>
    http.patch<Governorate>(`/shipping/governorates/${id}`, input),
  deleteGovernorate: (id: string) => http.delete<void>(`/shipping/governorates/${id}`),

  // Cities belonging to one governorate.
  listCitiesOfGovernorate: (governorateId: string, query: RegionFilter = {}) =>
    http.get<Page<City>>(`/shipping/governorates/${governorateId}/cities`, query),
  createCity: (governorateId: string, input: CreateRegionInput) =>
    http.post<City>(`/shipping/governorates/${governorateId}/cities`, input),
  updateCity: (governorateId: string, cityId: string, input: UpdateRegionInput) =>
    http.patch<City>(`/shipping/governorates/${governorateId}/cities/${cityId}`, input),
  deleteCity: (governorateId: string, cityId: string) =>
    http.delete<void>(`/shipping/governorates/${governorateId}/cities/${cityId}`),

  /**
   * Every city in the company, for a dropdown not driven by a governorate
   * selection. Read-only by design: creating a city always goes through its
   * governorate, so the parent is never ambiguous.
   */
  listCities: (query: RegionFilter & { governorateId?: string } = {}) =>
    http.get<Page<City>>("/shipping/cities", query),

  /**
   * Global reference data, not company-scoped.
   *
   * Paginated like every other list on the backend: `GET /shipping/countries`
   * answers with the shared Page envelope, not a bare array. Declaring it as
   * `Country[]` made callers treat the envelope object as an array, so
   * `countries.find(...)` threw a TypeError at render time.
   */
  listCountries: (query: { isActive?: boolean } = {}) =>
    http.get<Page<Country>>("/shipping/countries", query),
};
