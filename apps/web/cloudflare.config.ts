import { bindings, defineConfig, defineWorker } from "cf/config";
import { config as loadDotenv } from "dotenv";

loadDotenv({ quiet: true });

const text = (value: string | undefined) => bindings.text(value ?? "");

export default defineConfig({
  worker: defineWorker({
    name: "onevid",
    entrypoint: "./worker/index.ts",
    compatibilityDate: "2026-11-09",
    compatibilityFlags: ["nodejs_compat"],
    domains: ["onevid.hackw.tech"],
    observability: {
      enabled: true,
      headSamplingRate: 1,
      logs: {
        enabled: true,
        headSamplingRate: 1,
        invocationLogs: true,
        persist: true,
      },
      traces: {
        enabled: true,
        headSamplingRate: 1,
        persist: true,
      },
      issues: {
        enabled: true,
      },
    },
    assets: {
      htmlHandling: "none",
      notFoundHandling: "none",
      runWorkerFirst: ["/*", "!/_next/static/*", "!/*/_next/static/*"],
    },
    env: {
      ASSETS: bindings.assets(),
      IMAGES: bindings.images(),
      // Email Sending nativo de Cloudflare (dominio hackw.tech onboarded).
      EMAIL: bindings.sendEmail(),
      // Misma base de datos que hackw (el SSO comparte user/session), así que
      // se reutiliza su configuración de Hyperdrive. Query caching off:
      // sesiones y perfiles necesitan read-after-write.
      HYPERDRIVE: bindings.hyperdrive({
        id: "dd900a9e522944ceacd20cbea4d764ee",
        ...(process.env.DATABASE_URL
          ? { dev: { connectionString: process.env.DATABASE_URL } }
          : {}),
      }),

      RESEND_FROM: text(process.env.RESEND_FROM),

      BASE_URL: bindings.secret(),
      BETTER_AUTH_API_KEY: bindings.secret(),
      BETTER_AUTH_SECRET: bindings.secret(),
      COOKIE_DOMAIN: bindings.secret(),
      GOOGLE_CLIENT_ID: bindings.secret(),
      GOOGLE_CLIENT_SECRET: bindings.secret(),
      ONEVID_SECRET_KEY: bindings.secret(),
      RESEND_API_KEY: bindings.secret(),
      STREAM_API_KEY: bindings.secret(),
      STREAM_API_SECRET: bindings.secret(),
      TMDB_APP_READ_TOKEN: bindings.secret(),
    },
  }),
});
