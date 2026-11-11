import handler from "vinext/server/fetch-handler";

import { setEmailBinding } from "../src/lib/cloudflare-email";
import { runWithDatabase } from "../src/lib/db";

interface WorkerEnv {
  EMAIL?: unknown;
  HYPERDRIVE?: { connectionString: string };
  [key: string]: unknown;
}

type HandlerFetch = typeof handler.fetch;

/**
 * Custom Worker entrypoint: scopes a Postgres client to each request so `db`
 * can be used from Server Components, Route Handlers and Server Actions without
 * sharing sockets between invocations.
 *
 * In production the connection string comes from the Hyperdrive binding; during
 * local development it falls back to `DATABASE_URL` from `.env`.
 */
export default {
  __ensureInstrumentation: handler.__ensureInstrumentation,
  fetch(
    request: Request,
    env: WorkerEnv,
    ctx: Parameters<HandlerFetch>[2]
  ): ReturnType<HandlerFetch> {
    const connectionString =
      env.HYPERDRIVE?.connectionString ?? process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error(
        "Missing HYPERDRIVE binding or DATABASE_URL environment variable"
      );
    }

    setEmailBinding(env.EMAIL);
    return runWithDatabase(connectionString, () =>
      handler.fetch(request, env as Parameters<HandlerFetch>[1], ctx)
    );
  },
};
