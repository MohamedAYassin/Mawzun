import { z } from "zod";
import type { Db } from "../../config/database.js";
import { Permissions } from "../../constants/permissions.js";
import { NotFoundError } from "../../shared/errors.js";
import type { PaginationInput } from "../../shared/pagination.js";
import { notDeleted, orderBy, pageSlice, searchFilter } from "../../shared/query.js";
import { defineResource } from "../../shared/resource.js";
import { sealToken } from "./secretbox.js";
import { registerShopifyWebhooks } from "./shopifyRegistration.js";
import { env } from "../../config/env.js";
import { BadRequestError, ConflictError } from "../../shared/errors.js";

// Company-level gate has been replaced by the SaaS-wide env kill switch:
// env.SHOPIFY_FEATURE_ENABLED. Same UX — SHOPIFY store operations are
// rejected with self-host guidance when Shopify is off — but it is a
// deployment-level decision, not per tenant.
//
// Exported so the product-export path gates on the same switch instead of
// re-implementing the check (a second copy would drift and let one path run
// while the other is refused).
export async function assertShopifyEnabled(): Promise<void> {
  if (!env.SHOPIFY_FEATURE_ENABLED) {
    throw new BadRequestError(
      "مزامنة Shopify غير متاحة على هذه النسخة. لاستخدام Shopify استضف نسخة Mawzun خاصة بك — راجع docs.mawzun.org."
    );
  }
}

/** Per-company cap on SHOPIFY stores; CUSTOM stores are unlimited. */
async function assertShopifyStoreQuota(tx: Db, companyId: string): Promise<void> {
  const live = await tx.store.count({
    where: { companyId, platform: "SHOPIFY", deletedAt: null },
  });
  if (live >= env.MAX_SHOPIFY_STORES_PER_COMPANY) {
    throw new ConflictError(
      `الحد الأقصى ${env.MAX_SHOPIFY_STORES_PER_COMPANY} متاجر Shopify لكل شركة. احذف متجراً غير مستخدم أولاً.`
    );
  }
}

// External sales channels the company syncs with.

const StoreBaseSchema = z.object({
  name: z.string().trim().min(1, "الاسم مطلوب.").max(150),
  platform: z.enum(["CUSTOM", "SHOPIFY"]).default("CUSTOM"),
  storeUrl: z.string().trim().max(300).default(""),
  isActive: z.boolean().default(true),
  // Shopify app credentials (Admin API). The access token is sealed with AES-256-GCM before
  // it touches the database; the webhook secret verifies Shopify deliveries.
  shopifyAccessToken: z.string().trim().min(1).max(200).optional(),
  shopifyWebhookSecret: z.string().trim().min(1).max(200).optional(),
});

// A SHOPIFY store must present its credentials on create (validates the full payload).
//
// Skipped entirely when the Shopify feature is off: in that case the request is
// going to be refused by assertShopifyEnabled() with the self-host guidance, and
// demanding a token first would answer "مفتاح وصول Shopify مطلوب" — telling the
// caller to supply a credential for a feature this deployment does not have.
const requireShopifyCredentials = (val: z.infer<typeof StoreBaseSchema>, ctx: z.RefinementCtx) => {
  if (val.platform === "SHOPIFY" && env.SHOPIFY_FEATURE_ENABLED) {
    if (!val.shopifyAccessToken) {
      ctx.addIssue({ code: "custom", path: ["shopifyAccessToken"], message: "مفتاح وصول Shopify مطلوب لمتاجر Shopify." });
    }
    if (!val.shopifyWebhookSecret) {
      ctx.addIssue({ code: "custom", path: ["shopifyWebhookSecret"], message: "سر الويب هوك Shopify مطلوب لمتاجر Shopify." });
    }
  }
};

export const CreateStoreSchema = StoreBaseSchema.superRefine(requireShopifyCredentials);

export const UpdateStoreSchema = StoreBaseSchema.partial().strict();

export const StoreFilterSchema = z.object({
  platform: z.enum(["CUSTOM", "SHOPIFY"]).optional(),
  isActive: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
});

const SELECT = {
  id: true,
  name: true,
  platform: true,
  storeUrl: true,
  isActive: true,
  lastSyncedAt: true,
  createdAt: true,
  // Secrets are deliberately excluded: shopifyAccessToken is sealed at rest and neither
  // secret is ever returned to the client — only their presence.
  shopifyAccessToken: false,
  shopifyWebhookSecret: false,
  _count: { select: { syncErrors: true } },
} as const;

export const storeRoutes = defineResource({
  entity: "Store",
  createSchema: CreateStoreSchema,
  updateSchema: UpdateStoreSchema,
  filterSchema: StoreFilterSchema,
  view: [Permissions.ViewStores],
  manage: [Permissions.ManageStores],
  handlers: {
    async list(
      tx: Db,
      companyId: string,
      input: PaginationInput,
      filter: z.infer<typeof StoreFilterSchema>
    ) {
      const where = {
        companyId,
        ...notDeleted(input.includeDeleted),
        ...(filter.platform ? { platform: filter.platform } : {}),
        ...(filter.isActive === undefined ? {} : { isActive: filter.isActive }),
        ...searchFilter(["name", "storeUrl"], input.search),
      };

      // Sequential: `tx` is ONE connection — racing statements on it is not parallel.
      const items = await tx.store.findMany({
        where,
        orderBy: orderBy(input, ["name", "lastSyncedAt", "createdAt"], "createdAt"),
        ...pageSlice(input),
        select: SELECT,
      });
      const total = await tx.store.count({ where });
      return [items, total];
    },

    detail(tx: Db, companyId: string, id: string) {
      return tx.store.findFirst({ where: { id, companyId, deletedAt: null }, select: SELECT });
    },

    async create(tx: Db, companyId: string, data: z.infer<typeof CreateStoreSchema>) {
      if (data.platform === "SHOPIFY") {
        await assertShopifyEnabled();
        await assertShopifyStoreQuota(tx, companyId);
      }
      const { shopifyAccessToken, shopifyWebhookSecret, ...rest } = data;
      const store = await tx.store.create({
        data: {
          companyId,
          ...rest,
          ...(shopifyAccessToken
            ? { shopifyAccessToken: sealToken(shopifyAccessToken, env.APP_SECRET) }
            : {}),
          ...(shopifyWebhookSecret ? { shopifyWebhookSecret } : {}),
          ...(rest.platform === "SHOPIFY" && rest.storeUrl
            ? { shopifyShopDomain: rest.storeUrl.replace(/^https?:\/\//, "").replace(/\/$/, "") }
            : {}),
        },
        select: SELECT,
      });
      // Auto-register the sync webhooks on the merchant's Shopify (best-effort,
      // after the store row exists — see shopifyRegistration.ts). Runs off the
      // request's Prisma tx; uses its own HTTP calls, no DB access.
      if (rest.platform === "SHOPIFY" && shopifyAccessToken && store.storeUrl) {
        const reg = await registerShopifyWebhooks(
          store.storeUrl.replace(/^https?:\/\//, "").replace(/\/$/, ""),
          shopifyAccessToken,
          env.SHOPIFY_WEBHOOK_BASE_URL ?? ""
        );
        if (reg.error) console.error("shopify webhook registration failed", store.id, reg.error);
        else console.log("shopify webhooks registered", store.id, reg.created.length, "created,", reg.updated.length, "updated,", reg.skipped.length, "skipped");
      }
      return store;
    },

    async update(tx: Db, companyId: string, id: string, data: z.infer<typeof UpdateStoreSchema>) {
      const existing = await tx.store.findFirst({
        where: { id, companyId, deletedAt: null },
        select: { id: true, platform: true, storeUrl: true, shopifyShopDomain: true },
      });
      if (!existing) throw new NotFoundError("المتجر غير موجود.");
      // Turning a store INTO Shopify (or touching Shopify credentials) needs
      // the switch on; edits to CUSTOM stores are unaffected.
      if (data.platform === "SHOPIFY" || data.shopifyAccessToken || data.shopifyWebhookSecret) {
        await assertShopifyEnabled();
      }
      // Converting a CUSTOM store into Shopify consumes quota like a create.
      if (existing.platform !== "SHOPIFY" && data.platform === "SHOPIFY") {
        await assertShopifyStoreQuota(tx, companyId);
      }

      const { shopifyAccessToken, shopifyWebhookSecret, ...rest } = data;
      const store = await tx.store.update({
        where: { id },
        data: {
          ...rest,
          ...(shopifyAccessToken
            ? { shopifyAccessToken: sealToken(shopifyAccessToken, env.APP_SECRET) }
            : {}),
          ...(shopifyWebhookSecret ? { shopifyWebhookSecret } : {}),
          ...(rest.storeUrl !== undefined && rest.storeUrl !== ""
            ? { shopifyShopDomain: rest.storeUrl.replace(/^https?:\/\//, "").replace(/\/$/, "") }
            : {}),
        },
        select: SELECT,
      });
      // Also register on update: covers re-saving a store after the worker URL
      // changed, and newly-entered credentials. Best-effort, same as create.
      // Only when a fresh token accompanies the save (the sealed token is never
      // unsealed in the API layer); a re-save with just the URL is a no-op.
      const domain = existing.shopifyShopDomain || (rest.storeUrl ? store.storeUrl.replace(/^https?:\/\//, "").replace(/\/$/, "") : "");
      if (store.platform === "SHOPIFY" && domain && shopifyAccessToken && env.SHOPIFY_WEBHOOK_BASE_URL) {
        const reg = await registerShopifyWebhooks(
          domain,
          shopifyAccessToken,
          env.SHOPIFY_WEBHOOK_BASE_URL
        );
        if (reg.error) console.error("shopify webhook registration failed", store.id, reg.error);
        else console.log("shopify webhooks registered (update)", store.id, reg.created.length, "created,", reg.updated.length, "updated,", reg.skipped.length, "skipped");
      }
      return store;
    },

    async remove(tx: Db, _companyId: string, id: string) {
      await tx.store.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    },
  },
});
