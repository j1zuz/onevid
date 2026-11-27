import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle",
  schema: ["./src/lib/auth-schema.ts"],
  dialect: "postgresql",
  // La Postgres es compartida con hackw y store.hackw.tech, cada uno con sus
  // propias tablas. `drizzle-kit push` borra lo que su esquema no declara, así
  // que solo ve las tablas de esta app y las de auth que comparten las tres.
  // Una tabla nueva de otra app queda fuera por defecto. `rate_limit_bucket` y
  // `onevid_profile_activity` se crean con SQL a mano y no están en el esquema,
  // así que tampoco deben estar aquí: `push` las borraría.
  tablesFilter: [
    "user",
    "session",
    "account",
    "verification",
    "apikey",
    "device_code",
    "one_vid",
    "one_vid_addon",
    "one_vid_live_tv_source",
    "onevid_profile",
    "onevid_profile_saved",
    "onevid_profile_progress",
    "watch_room",
    "watch_room_member",
    "watch_room_state",
  ],
  dbCredentials: {
    // biome-ignore lint/style/noNonNullAssertion: env var validated at runtime
    url: process.env.DATABASE_URL!,
  },
});
