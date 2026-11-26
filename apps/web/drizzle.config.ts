import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle",
  schema: ["./src/lib/auth-schema.ts"],
  dialect: "postgresql",
  // La Postgres es compartida con store.hackw.tech, que gestiona sus propias
  // tablas (`store_*` y las del plugin organization). Sin este filtro,
  // `drizzle-kit push` las vería como sobrantes y propondría borrarlas.
  tablesFilter: ["!store_*", "!organization", "!member", "!invitation"],
  dbCredentials: {
    // biome-ignore lint/style/noNonNullAssertion: env var validated at runtime
    url: process.env.DATABASE_URL!,
  },
});
