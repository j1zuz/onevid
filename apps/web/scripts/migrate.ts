/**
 * Applies the committed SQL migrations in ./drizzle to the database.
 *
 * Runs automatically before `next start` (see package.json `start`) so schema
 * changes always reach the database on deploy and can no longer drift ahead of
 * it. Idempotent: Drizzle records applied migrations in `__drizzle_migrations`,
 * so re-running (e.g. on every boot) is a no-op once they are applied.
 *
 *   cd apps/web && bun run db:migrate
 */
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

// Locally the DATABASE_URL lives in .env.local; in deploy it comes from the
// process environment, so a missing file here is a harmless no-op.
config({ path: ".env.local" });

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error("Missing DATABASE_URL (check apps/web/.env.local)");
  process.exit(1);
}

const pool = new Pool({ connectionString });

try {
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  console.log("ok: migrations applied");
} finally {
  await pool.end();
}
