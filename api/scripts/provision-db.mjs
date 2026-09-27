// Provisions the runtime database role.
//
// The app runs request-time queries through a restricted Postgres role
// (DATABASE_URL) so row-level security enforces company isolation. The
// privileged connection (DIRECT_DATABASE_URL) handles identity resolution,
// migrations, seeding and platform administration.
//
// Grants live in the database, so this normally only matters once per
// database — but a restore, a dropped role, or a migrate reset silently
// clears them, and the symptom (every request 500s with
// 'permission denied for schema public') points nowhere near the cause.
// So the server runs this on every boot: idempotent, sub-second, and it
// turns that failure mode into a self-heal.

import pg from "pg";

function parseDatabaseUrl(connectionString) {
  const url = new URL(connectionString);
  return {
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.startsWith("/") ? url.pathname.slice(1) : url.pathname,
    host: url.hostname,
  };
}

function localSsl(host) {
  return ["localhost", "127.0.0.1", "::1"].includes(host) ? undefined : { rejectUnauthorized: false };
}

export async function provisionAppRole(databaseUrl, directUrl) {
  const appRole = parseDatabaseUrl(databaseUrl);
  const admin = parseDatabaseUrl(directUrl);

  if (appRole.user === admin.user) {
    return { status: "skipped", reason: "DATABASE_URL and DIRECT_DATABASE_URL share one role; it owns the tables and bypasses RLS by design." };
  }

  const adminClient = new pg.Client({ connectionString: directUrl, ssl: localSsl(admin.host) });
  try {
    await adminClient.connect();

    const roleExists = await adminClient.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [appRole.user]);
    if (roleExists.rowCount === 0) {
      // CREATE/ALTER ROLE reject bind parameters; format() quotes safely.
      const createRole = await adminClient.query(
        "SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', $1::text, $2::text) AS stmt",
        [appRole.user, appRole.password],
      );
      await adminClient.query(createRole.rows[0].stmt);
    } else {
      const alterRole = await adminClient.query(
        "SELECT format('ALTER ROLE %I LOGIN PASSWORD %L', $1::text, $2::text) AS stmt",
        [appRole.user, appRole.password],
      );
      await adminClient.query(alterRole.rows[0].stmt);
    }

    await adminClient.query('GRANT USAGE ON SCHEMA public TO "' + appRole.user + '"');
    await adminClient.query('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "' + appRole.user + '"');
    await adminClient.query('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "' + appRole.user + '"');

    try {
      await adminClient.query('ALTER DEFAULT PRIVILEGES FOR ROLE "' + admin.user + '" IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "' + appRole.user + '"');
      await adminClient.query('ALTER DEFAULT PRIVILEGES FOR ROLE "' + admin.user + '" IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO "' + appRole.user + '"');
    } catch {
      // Managed hosts may refuse ALTER DEFAULT PRIVILEGES; grants above still applied.
    }

    return { status: roleExists.rowCount === 0 ? "created" : "ensured", role: appRole.user };
  } finally {
    await adminClient.end().catch(() => {});
  }
}

// CLI entry: npm run db:provision
if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("provision-db.mjs")) {
  const databaseUrl = process.env.DATABASE_URL;
  const directUrl = process.env.DIRECT_DATABASE_URL;
  if (!databaseUrl || !directUrl) {
    console.error("provision-db: DATABASE_URL and DIRECT_DATABASE_URL are required.");
    process.exit(1);
  }
  provisionAppRole(databaseUrl, directUrl)
    .then((result) => {
      if (result.status === "skipped") console.log("provision-db: " + result.reason);
      else console.log("provision-db: " + result.status + " role " + result.role + " (schema/table/sequence grants ensured)");
    })
    .catch((error) => {
      console.error("provision-db failed:", error.message);
      process.exitCode = 1;
    });
}
