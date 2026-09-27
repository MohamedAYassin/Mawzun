// Mint the platform admin: company-less, isPlatformAdmin, random password printed once.
import fs from "node:fs";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

// The API lives in a sibling directory: ../Backend in the service layout, or
// ../api in the merged repository. Try both so this works in either checkout.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const API_DIR = [path.resolve(HERE, "..", "..", "Backend"), path.resolve(HERE, "..", "..", "api")]
  .find((d) => fs.existsSync(path.join(d, ".env")));
if (!API_DIR) throw new Error("Could not find the API directory (looked for ../Backend and ../api)");

// bcryptjs lives in the API's node_modules — resolve from there.
const require2 = createRequire(path.join(API_DIR, "package.json"));
const bcrypt = require2(process.env.BCRYPT_PATH || "bcryptjs");
const pg = require2("pg");
const envText = fs.readFileSync(path.join(API_DIR, ".env"), "utf8");
const client = new pg.Client({ connectionString: envText.match(/DIRECT_DATABASE_URL="([^"]+)"/)[1] });
await client.connect();
const existing = await client.query(`SELECT id, email FROM users WHERE "isPlatformAdmin" = true AND "deletedAt" IS NULL LIMIT 1`);
if (existing.rows[0]) {
  console.log("platform admin exists:", existing.rows[0].email);
} else {
  const email = process.env.PLATFORM_ADMIN_EMAIL || "admin@mawzun.org";
  const password = `Mz-Admin-${crypto.randomBytes(6).toString("base64url")}`;
  const hash = bcrypt.hashSync(password, 10);
  const stamp = crypto.randomBytes(24).toString("base64url");
  await client.query(
    `INSERT INTO users (id, "updatedAt", email, "passwordHash", "fullName", status, "isPlatformAdmin", "securityStamp")
     VALUES ($1, now(), $2, $3, 'Platform Admin', 'ACTIVE', true, $4)`,
    [crypto.randomUUID(), email, hash, stamp]
  );
  console.log("CREATED platform admin:", email, "password (once):", password);
}
await client.end();
