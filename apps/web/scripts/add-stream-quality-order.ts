/**
 * Añade `one_vid.stream_quality_order` (preferencia de orden/filtro de calidad).
 *
 * Va como script y no como `drizzle-kit push` porque push pide confirmación por
 * TTY y falla en cuanto no la hay. El DDL es idempotente, así que se puede
 * correr las veces que haga falta:
 *
 *   bun apps/web/scripts/add-stream-quality-order.ts
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

function readDatabaseUrl(): string {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }
  // El proyecto guarda las credenciales en .env.local, no en .env.
  const envPath = fileURLToPath(new URL("../.env.local", import.meta.url));
  const match = readFileSync(envPath, "utf8").match(
    /^DATABASE_URL=(?:"([^"]*)"|'([^']*)'|(.*))$/m
  );
  const url = match?.[1] ?? match?.[2] ?? match?.[3];
  if (!url) {
    throw new Error("No se encontró DATABASE_URL en apps/web/.env.local");
  }
  return url.trim();
}

const client = new Client({ connectionString: readDatabaseUrl() });
await client.connect();
await client.query(
  "ALTER TABLE one_vid ADD COLUMN IF NOT EXISTS stream_quality_order jsonb"
);
await client.end();
console.log("one_vid.stream_quality_order listo");
