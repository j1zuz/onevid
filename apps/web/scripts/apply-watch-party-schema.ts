import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { Client } from "pg";

config({ path: ".env.local" });

const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(here, "..", "drizzle", "watch-party.sql"), "utf8");
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("Falta DATABASE_URL en apps/web/.env.local");
}

const client = new Client({ connectionString });
await client.connect();
try {
  await client.query(sql);
  console.log("watch-party schema aplicado.");
} finally {
  await client.end();
}
