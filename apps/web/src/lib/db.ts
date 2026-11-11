import { AsyncLocalStorage } from "node:async_hooks";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client, Pool } from "pg";
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

/**
 * On Cloudflare Workers, I/O objects (such as Postgres sockets) cannot be
 * shared across requests. Instead of a module-scoped `Pool`, every request gets
 * its own client created from the Hyperdrive connection string, and the rest of
 * the app keeps importing `db` as before through a request-scoped proxy.
 *
 * `next dev` and `next build` do not go through the Worker entrypoint, so they
 * fall back to a module-scoped pool built from `DATABASE_URL`.
 */

type NodePgClient = Client | Pool;

const schema = {
  account,
  accountRelations,
  apikey,
  session,
  sessionRelations,
  user,
  userRelations,
  verification,
};

function createDatabase(client: NodePgClient) {
  return drizzle(client, { schema });
}

export type Database = ReturnType<typeof createDatabase>;

interface DatabaseStore {
  db: Database;
}

const storage = new AsyncLocalStorage<DatabaseStore>();

const isCloudflareWorkers =
  typeof navigator !== "undefined" &&
  navigator.userAgent === "Cloudflare-Workers";

const globalForDb = globalThis as unknown as { __onevidDb?: Database };

function createClient(connectionString: string) {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 10_000,
  });

  // Without a listener, an error on an idle client is thrown as an uncaught
  // exception and can crash the isolate.
  client.on("error", (error) => {
    console.error("pg client error:", error);
  });

  return client;
}

/**
 * Node fallback used by `next dev` and `next build`, which run outside the
 * Worker entrypoint. On Workers this branch never runs: `runWithDatabase`
 * always establishes the request store first.
 */
function getNodeDatabase(): Database {
  if (!globalForDb.__onevidDb) {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    });

    pool.on("error", (error) => {
      console.error("pg pool error:", error);
    });

    globalForDb.__onevidDb = createDatabase(pool);
  }

  return globalForDb.__onevidDb;
}

/**
 * Runs `fn` with a database client scoped to the current request. The client is
 * connected explicitly because the Workers `pg` driver does not reliably
 * auto-connect on writes. The Workers runtime tears down per-request I/O, and
 * Hyperdrive owns the real connection pool, so the client is not closed here.
 */
export async function runWithDatabase<T>(
  connectionString: string,
  fn: () => T | Promise<T>
): Promise<T> {
  const client = createClient(connectionString);
  await client.connect();

  const db = createDatabase(client);
  return storage.run({ db }, fn);
}

export function getDb(): Database {
  const store = storage.getStore();

  if (store) {
    return store.db;
  }

  if (isCloudflareWorkers) {
    throw new Error(
      "Database accessed outside of a request context. Make sure the Worker entrypoint wraps requests with runWithDatabase()."
    );
  }

  return getNodeDatabase();
}

/**
 * Request-aware stand-in for a module-scoped Drizzle instance. Property access
 * resolves against the client created for the current request.
 */
export const db = new Proxy({} as Database, {
  get(_target, property) {
    const requestDb = getDb();
    const value = Reflect.get(requestDb, property, requestDb);
    return typeof value === "function" ? value.bind(requestDb) : value;
  },
});
