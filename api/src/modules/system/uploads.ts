import multer from "multer";
import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import { requireCompanyContext } from "../../middleware/authorize.js";
import { uploadImage, UploadError } from "../../shared/storage.js";
import { BadRequestError } from "../../shared/errors.js";
import { handler, ok } from "../../shared/http.js";
import type { AuthedRequest } from "../../shared/request.js";
import { env } from "../../config/env.js";

// ---------------------------------------------------------------------------
// Generic image upload
// ---------------------------------------------------------------------------
//
// One endpoint for storing a selected image — avatars, brand logos, category
// images, and product images. Uploads land in R2 under companies/<companyId>/;
// the caller stores the returned asset address in the relevant record.
//
// multipart/form-data, single `file` field → { success, data: { url } }

// SVG is deliberately excluded even though it is "an image": it is a script
// container, and serving one from the image host is an XSS vector. The bytes
// are re-checked in uploadImage, so a spoofed Content-Type gets no further.
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

const router = Router();

router.post(
  "/uploads",
  authenticate,
  requireCompanyContext(),
  upload.single("file"),
  handler(async (req: AuthedRequest, res) => {
    const file = req.file;
    if (!file) throw new BadRequestError("لم يتم إرسال ملف الصورة.");

    const companyId = req.ctx.companyId!;
    let publicUrl: string;
    try {
      publicUrl = await uploadImage(companyId, file.originalname, file.buffer);
    } catch (err) {
      if (err instanceof UploadError) throw new BadRequestError(err.message);
      throw err;
    }

    return ok(res, { url: publicUrl }, "تم رفع الصورة بنجاح.");
  })
);

export { router as uploadRoutes };
