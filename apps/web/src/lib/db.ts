import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import {
  account,
  accountRelations,
  apikey,
  session,
  sessionRelations,
  user,
  userRelations,
  verification,
} from "./auth-schema";

// Reuse a single pool across Turbopack/HMR reloads in dev. Without this, every
// file change creates a new Pool (each up to `max` connections), which quickly
// exhausts PlanetScale's connection limit and makes queries fail intermittently
// (e.g. empty `listSessions`). In production the module loads once.
const globalForDb = globalThis as unknown as { __dbPool?: Pool };

const pool =
  globalForDb.__dbPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    // Close idle clients before PlanetScale's pooler drops them server-side,
    // so we never reuse a dead connection.
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });

// Required by pg: without a listener, an error on an idle client (e.g. the
// pooler closing it) is thrown as an uncaught exception and can crash the app.
pool.on("error", (err) => {
  console.error("pg pool error:", err);
});

if (process.env.NODE_ENV !== "production") {
  globalForDb.__dbPool = pool;
}

export const db = drizzle(pool, {
  schema: {
    account,
    accountRelations,
    apikey,
    session,
    sessionRelations,
    user,
    userRelations,
    verification,
  },
});
