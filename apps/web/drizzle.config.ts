import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle",
  schema: ["./src/lib/auth-schema.ts"],
  dialect: "postgresql",
  dbCredentials: {
    // biome-ignore lint/style/noNonNullAssertion: env var validated at runtime
    url: process.env.DATABASE_URL!,
  },
});
