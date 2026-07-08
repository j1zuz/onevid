import { hashPassword, verifyPassword } from "better-auth/crypto";
import { and, desc, eq } from "drizzle-orm";
import {
  oneVidProfile,
  oneVidProfileSaved,
  verification,
} from "@/lib/auth-schema";
import { db } from "@/lib/db";
import type { MediaMeta } from "@/lib/tmdb";

export const MAX_PROFILES = 5;

export const PROFILE_AVATARS = [
  "black",
  "blue",
  "green",
  "orange",
  "purple",
  "red",
] as const;

export type ProfileAvatar = (typeof PROFILE_AVATARS)[number];

const PIN_RE = /^\d{4}$/;

export interface Profile {
  avatar: string;
  createdAt: Date;
  id: string;
  isKids: boolean;
  name: string;
}

export function buildId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function isValidAvatar(value: unknown): value is ProfileAvatar {
  return (
    typeof value === "string" &&
    (PROFILE_AVATARS as readonly string[]).includes(value)
  );
}

export function isValidPin(value: unknown): value is string {
  return typeof value === "string" && PIN_RE.test(value);
}

export async function hashPin(pin: string): Promise<string> {
  return await hashPassword(pin);
}

export async function verifyPin(hash: string, pin: string): Promise<boolean> {
  return await verifyPassword({ hash, password: pin });
}

export type PinCheck = "ok" | "pin_required" | "pin_invalid";

/**
 * PIN hash of the primary (first-created) profile, which acts as the parent /
 * owner profile. null when there is no profile or it has no lock.
 */
export async function getPrimaryProfilePinHash(
  userId: string
): Promise<string | null> {
  const [row] = await db
    .select({ pinHash: oneVidProfile.pinHash })
    .from(oneVidProfile)
    .where(eq(oneVidProfile.userId, userId))
    .orderBy(oneVidProfile.createdAt)
    .limit(1);
  return row?.pinHash ?? null;
}

/**
 * Gate for managing profiles (create / edit / delete). When the primary
 * (first-created) profile has a PIN, the caller must supply THAT profile's PIN;
 * otherwise management is unrestricted. The primary profile's PIN is the master
 * key, so a child cannot create an unlocked profile to bypass parental controls.
 */
export async function checkManageAuth(
  userId: string,
  authPin: string | null | undefined
): Promise<PinCheck> {
  const hash = await getPrimaryProfilePinHash(userId);
  if (!hash) {
    return "ok";
  }
  if (!authPin) {
    return "pin_required";
  }
  return (await verifyPin(hash, authPin)) ? "ok" : "pin_invalid";
}

/**
 * Looks up a single profile's PIN hash, distinguishing a profile that does not
 * belong to the user (found: false) from one that exists but has no lock.
 */
export async function getProfilePinHashById(
  userId: string,
  profileId: string
): Promise<{ found: boolean; hash: string | null }> {
  const [row] = await db
    .select({ pinHash: oneVidProfile.pinHash })
    .from(oneVidProfile)
    .where(
      and(eq(oneVidProfile.id, profileId), eq(oneVidProfile.userId, userId))
    )
    .limit(1);
  if (!row) {
    return { found: false, hash: null };
  }
  return { found: true, hash: row.pinHash ?? null };
}

/** Removes the lock (pinHash) from the primary (first-created) profile. */
export async function clearPrimaryProfilePin(userId: string): Promise<void> {
  const [row] = await db
    .select({ id: oneVidProfile.id })
    .from(oneVidProfile)
    .where(eq(oneVidProfile.userId, userId))
    .orderBy(oneVidProfile.createdAt)
    .limit(1);
  if (!row) {
    return;
  }
  await db
    .update(oneVidProfile)
    .set({ pinHash: null })
    .where(eq(oneVidProfile.id, row.id));
}

// ─── Primary-profile PIN reset via emailed OTP ───────────────────────

const PIN_RESET_TTL_MS = 10 * 60 * 1000;
const PIN_RESET_PREFIX = "pin-reset:";

/** 6-digit numeric one-time code from a CSPRNG. */
function generateOtp(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return ((buf[0] ?? 0) % 1_000_000).toString().padStart(6, "0");
}

/**
 * Issues a fresh PIN-reset code for the user, replacing any prior one. The code
 * is returned in plaintext (to email) but only its hash is persisted, in the
 * shared `verification` table under a `pin-reset:<userId>` identifier.
 */
export async function createPinResetCode(userId: string): Promise<string> {
  const code = generateOtp();
  const identifier = PIN_RESET_PREFIX + userId;
  const now = new Date();
  await db.delete(verification).where(eq(verification.identifier, identifier));
  await db.insert(verification).values({
    id: buildId(),
    identifier,
    value: await hashPin(code),
    expiresAt: new Date(now.getTime() + PIN_RESET_TTL_MS),
    createdAt: now,
    updatedAt: now,
  });
  return code;
}

/**
 * Validates and consumes a PIN-reset code. Returns true only for a matching,
 * non-expired code; the stored code is deleted on success or expiry.
 */
export async function consumePinResetCode(
  userId: string,
  code: string
): Promise<boolean> {
  const identifier = PIN_RESET_PREFIX + userId;
  const [row] = await db
    .select({ value: verification.value, expiresAt: verification.expiresAt })
    .from(verification)
    .where(eq(verification.identifier, identifier))
    .orderBy(desc(verification.createdAt))
    .limit(1);
  if (!row) {
    return false;
  }
  if (row.expiresAt.getTime() < Date.now()) {
    await db
      .delete(verification)
      .where(eq(verification.identifier, identifier));
    return false;
  }
  const ok = Boolean(code) && (await verifyPin(row.value, code));
  if (ok) {
    await db
      .delete(verification)
      .where(eq(verification.identifier, identifier));
  }
  return ok;
}

export type ResolvedProfile =
  | { status: "ok"; profile: Profile }
  | { status: "no_profile" }
  | { status: "invalid_profile" };

/**
 * Resolves the active profile from the X-Profile-Id header. Missing header →
 * "no_profile" (409); a profile that doesn't belong to the account →
 * "invalid_profile" (400).
 */
export async function resolveActiveProfile(
  userId: string,
  profileId: string | null | undefined
): Promise<ResolvedProfile> {
  if (!profileId) {
    return { status: "no_profile" };
  }
  const [row] = await db
    .select({
      id: oneVidProfile.id,
      name: oneVidProfile.name,
      avatar: oneVidProfile.avatar,
      isKids: oneVidProfile.isKids,
      createdAt: oneVidProfile.createdAt,
    })
    .from(oneVidProfile)
    .where(
      and(eq(oneVidProfile.id, profileId), eq(oneVidProfile.userId, userId))
    )
    .limit(1);
  if (!row) {
    return { status: "invalid_profile" };
  }
  return { status: "ok", profile: row };
}

// ─── Per-profile favorites / watchlist ───────────────────────────────

export type SavedKind = "favorite" | "watchlist";
export type SavedMediaType = "movie" | "series";

export interface SavedInput {
  background?: string;
  mediaId: string;
  mediaType: SavedMediaType;
  name?: string;
  poster?: string;
  year?: string;
}

/** Upsert (value=true) or remove (value=false) a saved item for a profile. */
export async function setProfileSaved(
  profileId: string,
  kind: SavedKind,
  input: SavedInput,
  value: boolean
): Promise<void> {
  if (value) {
    await db
      .insert(oneVidProfileSaved)
      .values({
        id: buildId(),
        profileId,
        mediaId: input.mediaId,
        mediaType: input.mediaType,
        kind,
        name: input.name ?? null,
        poster: input.poster ?? null,
        background: input.background ?? null,
        year: input.year ?? null,
        createdAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          oneVidProfileSaved.profileId,
          oneVidProfileSaved.mediaType,
          oneVidProfileSaved.mediaId,
          oneVidProfileSaved.kind,
        ],
        set: {
          name: input.name ?? null,
          poster: input.poster ?? null,
          background: input.background ?? null,
          year: input.year ?? null,
        },
      });
    return;
  }

  await db
    .delete(oneVidProfileSaved)
    .where(
      and(
        eq(oneVidProfileSaved.profileId, profileId),
        eq(oneVidProfileSaved.mediaType, input.mediaType),
        eq(oneVidProfileSaved.mediaId, input.mediaId),
        eq(oneVidProfileSaved.kind, kind)
      )
    );
}

/** List a profile's saved items of a given kind/media type as MediaMeta. */
export async function listProfileSaved(
  profileId: string,
  kind: SavedKind,
  mediaType: SavedMediaType
): Promise<MediaMeta[]> {
  const rows = await db
    .select({
      mediaId: oneVidProfileSaved.mediaId,
      name: oneVidProfileSaved.name,
      poster: oneVidProfileSaved.poster,
      background: oneVidProfileSaved.background,
      year: oneVidProfileSaved.year,
    })
    .from(oneVidProfileSaved)
    .where(
      and(
        eq(oneVidProfileSaved.profileId, profileId),
        eq(oneVidProfileSaved.kind, kind),
        eq(oneVidProfileSaved.mediaType, mediaType)
      )
    )
    .orderBy(desc(oneVidProfileSaved.createdAt));

  return rows.map((r) => ({
    id: r.mediaId,
    type: mediaType,
    name: r.name ?? "",
    poster: r.poster ?? undefined,
    background: r.background ?? undefined,
    year: r.year ?? undefined,
  }));
}

/** Favorite/watchlist flags for a single title within a profile. */
export async function getProfileSavedStatus(
  profileId: string,
  mediaType: SavedMediaType,
  mediaId: string
): Promise<{ favorite: boolean; watchlist: boolean }> {
  const rows = await db
    .select({ kind: oneVidProfileSaved.kind })
    .from(oneVidProfileSaved)
    .where(
      and(
        eq(oneVidProfileSaved.profileId, profileId),
        eq(oneVidProfileSaved.mediaType, mediaType),
        eq(oneVidProfileSaved.mediaId, mediaId)
      )
    );
  return {
    favorite: rows.some((r) => r.kind === "favorite"),
    watchlist: rows.some((r) => r.kind === "watchlist"),
  };
}
