import multer from "multer";
import { Router } from "express";
import { z } from "zod";
import { uploadImage, deleteImage, UploadError } from "../../shared/storage.js";
import type { Db } from "../../config/database.js";
import { Permissions } from "../../constants/permissions.js";
import { requirePermission } from "../../middleware/authorize.js";
import { audit } from "../../shared/audit.js";
import { BadRequestError, NotFoundError } from "../../shared/errors.js";
import { param, scoped, type AuthedRequest } from "../../shared/request.js";
import { route } from "../../shared/route.js";
import { handler, created } from "../../shared/http.js";
import { env } from "../../config/env.js";

// ---------------------------------------------------------------------------
// Product images
// ---------------------------------------------------------------------------
//
// A product has a gallery plus a single `imageUrl` used wherever one picture
// stands in for the product — a list row, a cart line, a shipment label.
// `imageUrl` is kept in step with the gallery's primary image by
// `syncPrimary`, so the two never disagree about what the product looks like.

export const CreateProductImageSchema = z.object({
  imageUrl: z.string().trim().min(1, "رابط الصورة مطلوب.").max(2000),
  altText: z.string().trim().max(255).nullish(),
  sortOrder: z.coerce.number().int().min(0).default(0),
  isPrimary: z.boolean().default(false),
});

export const UpdateProductImageSchema = z.object({
  imageUrl: z.string().trim().min(1).max(2000).optional(),
  altText: z.string().trim().max(255).nullish(),
  sortOrder: z.coerce.number().int().min(0).optional(),
  isPrimary: z.boolean().optional(),
});

const SELECT = {
  id: true,
  imageUrl: true,
  altText: true,
  sortOrder: true,
  isPrimary: true,
  createdAt: true,
} as const;

/**
 * Makes `primaryId` the only primary image and mirrors it onto the product.
 *
 * Both writes happen in the caller's transaction, so a product can never end
 * up pointing at an image that is not flagged primary.
 */
async function syncPrimary(
  tx: Db,
  companyId: string,
  productId: string,
  primaryId: string | null
) {
  await tx.productImage.updateMany({
    where: { productId, companyId },
    data: { isPrimary: false },
  });

  if (primaryId) {
    await tx.productImage.update({
      where: { id: primaryId },
      data: { isPrimary: true },
    });
  }

  // The "primary" concept lives entirely in product_images.isPrimary — the
  // products table has no imageUrl column, and the list endpoint derives the
  // primary image from this flag.
}

const router = Router({ mergeParams: true });

// Raster formats only. SVG is excluded on purpose — it is a script container,
// and the image host must not serve one. uploadImage re-checks the bytes, so a
// spoofed Content-Type is rejected there too.
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.UPLOAD_MAX_BYTES, files: 1 },
  fileFilter: (_req, file, callback) => {
    callback(null, ALLOWED_MIME.has(file.mimetype.toLowerCase()));
  },
});

/**
 * Multipart upload: stores the file in R2 and registers the returned public
 * URL as an image row. multipart/form-data with a single `file` field;
 * isPrimary / altText / sortOrder travel as form fields.
 */
router.post(
  "/upload",
  requirePermission(Permissions.UpdateProduct),
  upload.single("file"),
  handler(async (req: AuthedRequest, res) => {
    const productId = param(req, "productId");
    const file = req.file;
    if (!file) throw new BadRequestError("لم يتم إرسال ملف الصورة.");

    return scoped(req, async (tx) => {
      const companyId = req.ctx.companyId!;
      const product = await tx.product.findFirst({
        where: { id: productId, companyId, deletedAt: null },
        select: { id: true },
      });
      if (!product) throw new NotFoundError("المنتج غير موجود.");

      let publicUrl: string;
      try {
        publicUrl = await uploadImage(companyId, file.originalname, file.buffer);
      } catch (err) {
        if (err instanceof UploadError) throw new BadRequestError(err.message);
        throw err;
      }

      const existing = await tx.productImage.count({ where: { productId, companyId } });
      const isPrimary = req.body.isPrimary === "true" || existing === 0;

      const image = await tx.productImage.create({
        data: {
          companyId,
          productId,
          imageUrl: publicUrl,
          altText: typeof req.body.altText === "string" ? req.body.altText.slice(0, 255) : null,
          sortOrder: Number(req.body.sortOrder ?? existing) || 0,
          isPrimary,
        },
        select: SELECT,
      });

      if (image.isPrimary) {
        await syncPrimary(tx, companyId, productId, image.id);
      }

      await audit(tx, {
        action: "productImage.uploaded",
        entity: "ProductImage",
        entityId: image.id,
        summary: "تم رفع صورة للمنتج.",
      });

      created(res, image, "تم رفع الصورة بنجاح.");
    });
  })
);
router.get(
  "/",
  requirePermission(Permissions.ViewProducts),
  route(async (req: AuthedRequest) =>
    scoped(req, async (tx) => {
      const productId = param(req, "productId");
      const product = await tx.product.findFirst({
        where: { id: productId, companyId: req.ctx.companyId!, deletedAt: null },
        select: { id: true },
      });
      if (!product) throw new NotFoundError("المنتج غير موجود.");

      return tx.productImage.findMany({
        where: { productId },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: SELECT,
      });
    })
  )
);

router.post(
  "/",
  requirePermission(Permissions.UpdateProduct),
  route(
    async (req: AuthedRequest) => {
      const productId = param(req, "productId");
      const data = CreateProductImageSchema.parse(req.body);

      return scoped(req, async (tx) => {
        const companyId = req.ctx.companyId!;
        const product = await tx.product.findFirst({
          where: { id: productId, companyId, deletedAt: null },
          select: { id: true },
        });
        if (!product) throw new NotFoundError("المنتج غير موجود.");

        const existing = await tx.productImage.count({ where: { productId, companyId } });

        const created = await tx.productImage.create({
          data: {
            companyId,
            productId,
            imageUrl: data.imageUrl,
            altText: data.altText ?? null,
            sortOrder: data.sortOrder,
            // The first image a product gets is its primary one; otherwise a
            // product would have a gallery and no thumbnail.
            isPrimary: data.isPrimary || existing === 0,
          },
          select: SELECT,
        });

        if (created.isPrimary) {
          await syncPrimary(tx, companyId, productId, created.id);
        }

        await audit(tx, {
          action: "productImage.created",
          entity: "ProductImage",
          entityId: created.id,
          summary: "تمت إضافة صورة للمنتج.",
        });

        return created;
      });
    },
    { status: 201, message: "تمت إضافة الصورة بنجاح." }
  )
);

router.patch(
  "/:id",
  requirePermission(Permissions.UpdateProduct),
  route(
    async (req: AuthedRequest) => {
      const productId = param(req, "productId");
      const id = param(req, "id");
      const data = UpdateProductImageSchema.parse(req.body);

      return scoped(req, async (tx) => {
        const companyId = req.ctx.companyId!;
        const image = await tx.productImage.findFirst({
          where: { id, productId, companyId },
          select: { id: true },
        });
        if (!image) throw new NotFoundError("الصورة غير موجودة.");

        const updated = await tx.productImage.update({
          where: { id },
          data: {
            imageUrl: data.imageUrl,
            altText: data.altText,
            sortOrder: data.sortOrder,
          },
          select: SELECT,
        });

        if (data.isPrimary === true) {
          await syncPrimary(tx, companyId, productId, id);
        } else if (data.isPrimary === false) {
          // Clearing the primary flag without naming a replacement would leave
          // the product with no thumbnail at all.
          throw new BadRequestError("لتعطيل الصورة الرئيسية، حدد صورة رئيسية أخرى.");
        }

        await audit(tx, {
          action: "productImage.updated",
          entity: "ProductImage",
          entityId: id,
          summary: "تم تحديث صورة المنتج.",
          changes: data,
        });

        return { ...updated, isPrimary: data.isPrimary ?? updated.isPrimary };
      });
    },
    { message: "تم تحديث الصورة بنجاح." }
  )
);

router.post(
  "/:id/primary",
  requirePermission(Permissions.UpdateProduct),
  route(async (req: AuthedRequest) =>
    scoped(req, async (tx) => {
      const productId = param(req, "productId");
      const id = param(req, "id");

      const image = await tx.productImage.findFirst({
        where: { id, productId, companyId: req.ctx.companyId! },
        select: { id: true },
      });
      if (!image) throw new NotFoundError("الصورة غير موجودة.");

      await syncPrimary(tx, req.ctx.companyId!, productId, id);

      await audit(tx, {
        action: "productImage.setPrimary",
        entity: "ProductImage",
        entityId: id,
        summary: "تم تعيين الصورة الرئيسية للمنتج.",
      });

      return tx.productImage.findUniqueOrThrow({ where: { id }, select: SELECT });
    })
  )
);

router.delete(
  "/:id",
  requirePermission(Permissions.UpdateProduct),
  route(async (req: AuthedRequest) =>
    scoped(req, async (tx) => {
      const productId = param(req, "productId");
      const id = param(req, "id");
      const companyId = req.ctx.companyId!;

      const image = await tx.productImage.findFirst({
        where: { id, productId, companyId },
        select: { id: true, isPrimary: true, imageUrl: true },
      });
      if (!image) throw new NotFoundError("الصورة غير موجودة.");

      await tx.productImage.delete({ where: { id } });

      // Best-effort object cleanup: a failed delete must not fail the
      // request, and an external URL is not ours to remove.
      void deleteImage(image.imageUrl).catch(() => undefined);

      // Removing the thumbnail must promote another image rather than leaving
      // the product pointing at a deleted row.
      if (image.isPrimary) {
        const next = await tx.productImage.findFirst({
          where: { productId, companyId },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          select: { id: true },
        });
        await syncPrimary(tx, companyId, productId, next?.id ?? null);
      }

      await audit(tx, {
        action: "productImage.deleted",
        entity: "ProductImage",
        entityId: id,
        summary: "تم حذف صورة المنتج.",
      });

      return null;
    })
  )
);

export { router as productImageRoutes };
