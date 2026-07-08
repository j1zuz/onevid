import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
  username: text("username").unique(),
  displayUsername: text("display_username"),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_userId_idx").on(table.userId)]
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)]
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)]
);

export const apikey = pgTable(
  "apikey",
  {
    id: text("id").primaryKey(),
    configId: text("config_id").default("default").notNull(),
    name: text("name"),
    start: text("start"),
    referenceId: text("reference_id").notNull(),
    prefix: text("prefix"),
    key: text("key").notNull(),
    refillInterval: integer("refill_interval"),
    refillAmount: integer("refill_amount"),
    lastRefillAt: timestamp("last_refill_at"),
    enabled: boolean("enabled").default(true),
    rateLimitEnabled: boolean("rate_limit_enabled").default(true),
    rateLimitTimeWindow: integer("rate_limit_time_window").default(86_400_000),
    rateLimitMax: integer("rate_limit_max").default(10),
    requestCount: integer("request_count").default(0),
    remaining: integer("remaining"),
    lastRequest: timestamp("last_request"),
    expiresAt: timestamp("expires_at"),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
    permissions: text("permissions"),
    metadata: text("metadata"),
  },
  (table) => [
    index("apikey_configId_idx").on(table.configId),
    index("apikey_referenceId_idx").on(table.referenceId),
    index("apikey_key_idx").on(table.key),
  ]
);

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  oneVid: many(oneVid),
  oneVidAddons: many(oneVidAddon),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));

export const oneVid = pgTable(
  "one_vid",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Deprecated: legacy "paste your Read Access Token" flow. Kept for backwards
    // compatibility during migration to the TMDB OAuth v4 user token below.
    tmdbReadAccessToken: text("tmdb_read_access_token"),
    // TMDB OAuth v4 user access token (read + write). Does not expire by time;
    // persists until the user revokes access in TMDB or we clear it.
    tmdbUserAccessToken: text("tmdb_user_access_token"),
    // TMDB v4 account id tied to the user access token (used for favorite/watchlist writes).
    tmdbAccountId: text("tmdb_account_id"),
    torboxApiKey: text("torbox_api_key"),
    setupCompleted: boolean("setup_completed").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("one_vid_userId_idx").on(table.userId)]
);

export const oneVidAddon = pgTable(
  "one_vid_addon",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    baseUrl: text("base_url").notNull(),
    manifestId: text("manifest_id").notNull(),
    manifestName: text("manifest_name").notNull(),
    manifestVersion: text("manifest_version"),
    manifestDescription: text("manifest_description"),
    supportsStreams: boolean("supports_streams").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("one_vid_addon_userId_idx").on(table.userId)]
);

export const oneVidRelations = relations(oneVid, ({ one }) => ({
  user: one(user, {
    fields: [oneVid.userId],
    references: [user.id],
  }),
}));

export const oneVidAddonRelations = relations(oneVidAddon, ({ one }) => ({
  user: one(user, {
    fields: [oneVidAddon.userId],
    references: [user.id],
  }),
}));

// Netflix-style profiles under a single account (max 5, enforced in the API).
export const oneVidProfile = pgTable(
  "onevid_profile",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // Avatar color key: black|blue|green|orange|purple|red (images live in the app).
    avatar: text("avatar").default("blue").notNull(),
    isKids: boolean("is_kids").default(false).notNull(),
    // Optional per-profile 4-digit PIN (scrypt hash). null = no lock (Netflix-style).
    pinHash: text("pin_hash"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("onevid_profile_user").on(table.userId)]
);

// Per-profile favorites / watchlist, stored in hackw (TMDB has no profile concept).
export const oneVidProfileSaved = pgTable(
  "onevid_profile_saved",
  {
    id: text("id").primaryKey(),
    profileId: text("profile_id")
      .notNull()
      .references(() => oneVidProfile.id, { onDelete: "cascade" }),
    mediaId: text("media_id").notNull(),
    mediaType: text("media_type").notNull(), // 'movie' | 'series'
    kind: text("kind").notNull(), // 'favorite' | 'watchlist'
    name: text("name"),
    poster: text("poster"),
    background: text("background"),
    year: text("year"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("onevid_profile_saved_unique").on(
      table.profileId,
      table.mediaType,
      table.mediaId,
      table.kind
    ),
  ]
);

export const oneVidProfileRelations = relations(oneVidProfile, ({ one }) => ({
  user: one(user, {
    fields: [oneVidProfile.userId],
    references: [user.id],
  }),
}));

export const oneVidProfileSavedRelations = relations(
  oneVidProfileSaved,
  ({ one }) => ({
    profile: one(oneVidProfile, {
      fields: [oneVidProfileSaved.profileId],
      references: [oneVidProfile.id],
    }),
  })
);

export const deviceCode = pgTable(
  "device_code",
  {
    id: text("id").primaryKey(),
    deviceCode: text("device_code").notNull().unique(),
    userCode: text("user_code").notNull().unique(),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    clientId: text("client_id"),
    scope: text("scope"),
    status: text("status").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    lastPolledAt: timestamp("last_polled_at"),
    pollingInterval: integer("polling_interval"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("device_code_userCode_idx").on(table.userCode),
    index("device_code_deviceCode_idx").on(table.deviceCode),
  ]
);
