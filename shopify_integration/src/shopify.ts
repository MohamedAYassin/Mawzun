// HMAC verification + Shopify Admin API client.
//
// Webhook authenticity: Shopify signs every delivery with the app's client
// secret in the `X-Shopify-Hmac-Sha256` header (base64 HMAC-SHA256 over the
// raw request body). A request that fails verification is dropped with 401 —
// never parsed, never trusted.

export async function verifyWebhook(
  rawBody: string,
  hmacHeader: string,
  clientSecret: string
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(clientSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));
  if (expected.length !== hmacHeader.length) return false;
  // constant-time compare
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ hmacHeader.charCodeAt(i);
  return diff === 0;
}

/** One discounted amount on a line, or on the order's shipping. */
export interface ShopifyDiscountAllocation {
  amount: string | number;
}

/**
 * An Admin API call that failed. `status` is what callers branch on: 429 and 5xx
 * are worth retrying (the request was fine, the moment was not), while 4xx means
 * the payload is wrong and retrying just repeats the failure.
 */
export class ShopifyApiError extends Error {
  // Declared and assigned explicitly rather than as constructor parameter
  // properties: Node's strip-only TypeScript mode (used by `node file.ts` and by
  // this worker's verifier) rejects parameter properties outright, so they would
  // work in the bundle and fail everywhere else.
  readonly status: number;
  readonly retryAfterSeconds?: number;

  constructor(message: string, status: number, retryAfterSeconds?: number) {
    super(message);
    this.name = "ShopifyApiError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }

  /** Rate limited or a server-side fault — retryable without changing the request. */
  get retryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}

export interface ShopifyOrder {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  created_at: string;
  total_price: string;
  currency: string | null;
  cancelled_at?: string | null;
  cancel_reason?: string | null;
  closed_at?: string | null;
  fulfilled_at?: string | null;
  customer?: { first_name?: string; last_name?: string; email?: string; phone?: string } | null;
  line_items: {
    id: number;
    sku: string | null;
    title: string;
    quantity: number;
    price: string;
    // Shopify reports `price` gross and the reduction here; the net unit price
    // is computed at ingest (see ingest.ts totalDiscount).
    discount_allocations?: ShopifyDiscountAllocation[] | null;
  }[];
  // Amount actually charged for shipping. The shipping ADDRESS carries no
  // amount — reading it from there is a common way to book shipping as zero.
  shipping_lines?: {
    price?: string | number;
    discount_allocations?: ShopifyDiscountAllocation[] | null;
  }[] | null;
  shipping_address?: {
    first_name?: string; last_name?: string; address1?: string;
    city?: string; province?: string; country?: string; zip?: string; phone?: string;
  } | null;
}

// Shopify product payload (products/create + products/update webhooks and
// GET /products/:id.json). Shared by the product-sync module.
export interface ShopifyProduct {
  id: number;
  title: string;
  status?: string; // active | archived | draft
  image?: { src?: string } | null;
  variants: {
    id: number;
    sku: string | null;
    title?: string;
    option1?: string | null;
    option2?: string | null;
    option3?: string | null;
    price: string;
    barcode?: string | null;
    inventory_item_id?: number | null;
    image_id?: number | null;
  }[];
  images?: { id: number | null; src: string; variant_ids?: number[] }[];
}

export class ShopifyAdminApi {
  constructor(
    private shopDomain: string,
    private accessToken: string
  ) {}

  private url(path: string): string {
    return `https://${this.shopDomain}/admin/api/2026-01${path}`;
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(this.url(path), {
      headers: { "X-Shopify-Access-Token": this.accessToken },
    });
    if (!res.ok) throw new Error(`Shopify GET ${path} → ${res.status}`);
    const body = (await res.json()) as Record<string, unknown>;
    return Object.values(body)[0] as T;
  }

  /**
   * Throws a ShopifyApiError carrying the HTTP status so callers can tell a
   * permanent rejection (422 bad payload) from a retryable one (429 rate
   * limited, 5xx). A bare Error with the status in the message forces callers
   * to string-match, which is how a rate limit ends up counted as a data error.
   */
  async post(path: string, body: unknown): Promise<void> {
    const res = await fetch(this.url(path), {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": this.accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      // Shopify's Retry-After is in seconds on a 429.
      const retryAfter = Number(res.headers.get("Retry-After") ?? "") || undefined;
      throw new ShopifyApiError(`Shopify POST ${path} → ${res.status}`, res.status, retryAfter);
    }
  }

  async getOrder(id: number): Promise<ShopifyOrder> {
    return this.get<ShopifyOrder>(`/orders/${id}.json`);
  }
}
