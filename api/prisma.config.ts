import "dotenv/config";
import { defineConfig } from "prisma/config";

// Prisma 7 config. The CLI no longer reads package.json#prisma and no longer
// auto-loads .env, so both responsibilities land here.
export default defineConfig({
  // Multi-file schema: every .prisma file in this folder is merged.
  schema: "prisma/schema",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // The CLI (migrate, studio, db seed) runs as the privileged role. That is
    // what lets a migration provision schema objects and manage grants, which
    // the runtime role must never be able to do.
    //
    // This URL is NOT what the running server uses. The server builds its own
    // driver adapter from DATABASE_URL, so the restricted role is what
    // enforces row-level security at runtime.
    //
    // Falls back to DATABASE_URL for single-URL hosts (Heroku), where the one
    // role owns the tables anyway.
    url: process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL,
  },
});
