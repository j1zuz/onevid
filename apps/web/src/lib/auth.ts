import { apiKey } from "@better-auth/api-key";
import { dash } from "@better-auth/infra";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer, deviceAuthorization, magicLink } from "better-auth/plugins";
import { username } from "better-auth/plugins/username";
import { Resend } from "resend";
import {
  DEFAULT_LANGUAGE,
  SUPPORTED_CODES,
  type SupportedLanguage,
} from "@/lib/languages";
import { renderMagicLinkEmail } from "../email/email";
import {
  account,
  accountRelations,
  apikey,
  deviceCode,
  session,
  sessionRelations,
  user,
  userRelations,
  verification,
} from "./auth-schema";
import { db } from "./db";
import {
  isUsernameAllowed,
  MAX_USERNAME_LEN,
  MIN_USERNAME_LEN,
} from "./username-validation";

function parseLocaleFromMagicLinkUrl(url: string): SupportedLanguage {
  try {
    const urlObj = new URL(url);
    const callbackEncoded = urlObj.searchParams.get("callbackURL") ?? "";
    const callbackDecoded = decodeURIComponent(callbackEncoded);
    const qIndex = callbackDecoded.indexOf("?");
    if (qIndex !== -1) {
      const locale =
        new URLSearchParams(callbackDecoded.slice(qIndex + 1)).get("locale") ??
        "";
      if (SUPPORTED_CODES.includes(locale as SupportedLanguage)) {
        return locale as SupportedLanguage;
      }
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_LANGUAGE;
}

const resend = new Resend(process.env.RESEND_API_KEY ?? "");

export const auth = betterAuth({
  appName: "Hackw",
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      account,
      accountRelations,
      apikey,
      deviceCode,
      session,
      sessionRelations,
      user,
      userRelations,
      verification,
    },
  }),
  baseURL: process.env.BASE_URL ?? "",
  advanced: {
    ipAddress: {
      ipAddressHeaders: ["cf-connecting-ip", "x-forwarded-for"],
    },
  },
  experimental: {
    joins: true,
  },
  socialProviders: {
    apple: {
      clientId: process.env.APPLE_CLIENT_ID ?? "",
      clientSecret: process.env.APPLE_CLIENT_SECRET ?? "",
    },
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    },
  },
  plugins: [
    apiKey(),
    bearer(),
    dash(),
    deviceAuthorization({
      verificationUri: "/device",
      expiresIn: "15m",
      interval: "5s",
      schema: {}, // workaround: better-auth marca `schema` como obligatorio bajo zod v4
    }),
    username({
      minUsernameLength: MIN_USERNAME_LEN,
      maxUsernameLength: MAX_USERNAME_LEN,
      usernameValidator: (value) => isUsernameAllowed(value),
    }),
    magicLink({
      storeToken: "hashed",
      sendMagicLink: async ({ email, url }) => {
        const locale = parseLocaleFromMagicLinkUrl(url);
        const { html, subject } = await renderMagicLinkEmail(
          url,
          email,
          locale
        );
        const from = process.env.RESEND_FROM ?? "";
        const { error } = await resend.emails.send({
          from,
          to: email,
          subject,
          html,
        });
        if (error) {
          throw new Error(error.message);
        }
      },
    }),
  ],
});

export type AuthInstance = typeof auth;
