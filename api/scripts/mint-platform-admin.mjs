// Mint the platform admin: company-less, isPlatformAdmin, random password printed once.
// Run from Backend/ so bcryptjs resolves: node ../admin/scripts/mint-platform-admin.mjs
import fs from "node:fs";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import pg from "pg";

const envText = fs.readFileSync(new URL("../.env", import.meta.url), "utf8");
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
