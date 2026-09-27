import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { env } from "../config/env.js";
import { formatMegabytesAr } from "./formatBytes.js";

// ---------------------------------------------------------------------------
// Cloudflare R2 object storage
// ---------------------------------------------------------------------------
//
// Product images are stored as objects in an R2 bucket and referenced by their
// public URL; nothing is served from this process. The bucket is addressed
// through the S3-compatible endpoint, so the standard AWS SDK speaks to it.
//
// Required environment (all four, no defaults — a misconfigured deployment
// fails loudly at first upload instead of silently linking dead URLs):
//   R2_ACCOUNT_ID       - Cloudflare account id (builds the endpoint)
//   R2_ACCESS_KEY_ID    - R2 API token access key
//   R2_SECRET_ACCESS_KEY- R2 API token secret
//   R2_BUCKET           - bucket name
//   R2_PUBLIC_BASE_URL  - the bucket's public base URL (custom domain or
//                         r2.dev), e.g. https://images.example.com
// ---------------------------------------------------------------------------

// R2 buckets created under a jurisdiction (EU, FedRAMP) live on a
// jurisdiction-specific endpoint and are INVISIBLE from the default one —
// ListBuckets comes back empty and PutObject answers NoSuchBucket even
// though the credentials are valid. Set R2_JURISDICTION=eu (or fedramp) to
// match the bucket's badge in the dashboard.
const endpoint = () => {
  const jurisdiction = (process.env.R2_JURISDICTION ?? "").toLowerCase();
  const sub = jurisdiction === "eu" || jurisdiction === "fedramp" ? `.${jurisdiction}` : "";
  return `https://${process.env.R2_ACCOUNT_ID}${sub}.r2.cloudflarestorage.com`;
};

let client: S3Client | null = null;

function s3(): S3Client {
  if (!client) {
    client = new S3Client({
      region: "auto",
      endpoint: endpoint(),
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
      },
      // Never let a wedged connection hang a request handler: an upload that
      // cannot complete in 15s fails with the standard Arabic upload error.
      requestHandler: {
        requestTimeout: 15_000,
        connectionTimeout: 5_000,
      },
    });
  }
  return client;
}

export function isR2Configured(): boolean {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET &&
      process.env.R2_PUBLIC_BASE_URL
  );
}

/** Extensions we accept, mapped to their content type. */
const ALLOWED_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
};

/**
 * Magic-byte signatures for the accepted raster formats.
 *
 * The extension is a filename the client chose and the mimetype is a header the
 * client sent — neither is evidence about the bytes. An SVG renamed to .png with
 * Content-Type: image/png would otherwise be stored and served from the image
 * host, and SVG is a script container (it can carry <script> and event
 * handlers), so serving one from our own origin is an XSS vector. The bytes
 * decide.
 */
function sniffImage(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;
  const b = buffer;
  // JPEG: FF D8 FF
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  // GIF: "GIF87a" / "GIF89a"
  if (b.toString("ascii", 0, 6) === "GIF87a" || b.toString("ascii", 0, 6) === "GIF89a") return "image/gif";
  // RIFF....WEBP
  if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  // AVIF/HEIF: ISO-BMFF box "ftyp" with an avif/heic brand
  if (b.toString("ascii", 4, 8) === "ftyp") {
    const brand = b.toString("ascii", 8, 12);
    if (brand === "avif" || brand === "avis") return "image/avif";
  }
  // Anything else — including SVG ("<svg", "<?xml") — is not a raster image.
  return null;
}

export class UploadError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
  }
}

/**
 * Uploads an image buffer under `companies/<companyId>/<uuid><ext>` and
 * returns its public URL. Company-prefixing keeps deletion audits trivial.
 */
export async function uploadImage(
  companyId: string,
  filename: string,
  buffer: Buffer
): Promise<string> {
  if (!isR2Configured()) {
    throw new UploadError(
      "تخزين الصور غير مهيأ على الخادم (R2). تواصل مع مسؤول النظام."
    );
  }

  const ext = path.extname(filename || "").toLowerCase();
  const declared = ALLOWED_TYPES[ext];
  if (!declared) {
    throw new UploadError(
      "صيغة الصورة غير مدعومة. المسموح: jpg، png، webp، gif، avif."
    );
  }
  // Belt-and-braces: multer already rejects an oversized body, but this runs on
  // the raw bytes so a caller that bypasses the HTTP layer still cannot store an
  // oversized object. Reads the same env var as multer so the two cannot drift.
  if (buffer.length > env.UPLOAD_MAX_BYTES) {
    throw new UploadError(
      `حجم الصورة يتجاوز ${formatMegabytesAr(env.UPLOAD_MAX_BYTES)}.`
    );
  }

  // The bytes must match an accepted raster format. The stored extension and
  // Content-Type come from the sniff, not from the client, so a file whose name
  // and header disagree with its content cannot land in the bucket.
  const sniffed = sniffImage(buffer);
  if (!sniffed) {
    throw new UploadError(
      "محتوى الملف ليس صورة مدعومة. المسموح: jpg، png، webp، gif، avif."
    );
  }
  const contentType = sniffed;
  const safeExt =
    Object.entries(ALLOWED_TYPES).find(([, type]) => type === contentType)?.[0] ?? ext;

  const key = `companies/${companyId}/${randomUUID()}${safeExt}`;
  try {
    await s3().send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        CacheControl: "public, max-age=31536000, immutable",
      })
    );
  } catch (err) {
    // Credentials, bucket or endpoint problems surface here as a 5xx from the
    // SDK; convert to a clear client-visible failure instead of a 500.
    console.error("R2 upload failed:", err);
    throw new UploadError("فشل رفع الصورة إلى التخزين. تحقق من إعدادات R2.");
  }

  return `${process.env.R2_PUBLIC_BASE_URL}/${key}`;
}

/** Deletes an object given its public URL (inverse of uploadImage). */
export async function deleteImage(publicUrl: string): Promise<void> {
  if (!isR2Configured()) return;
  const base = process.env.R2_PUBLIC_BASE_URL!;
  if (!publicUrl.startsWith(`${base}/companies/`)) return; // external URL, not ours
  const key = publicUrl.slice(base.length + 1);
  await s3().send(
    new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key })
  );
}
