/**
 * Avatares de perfil (compartido por cliente y servidor).
 *
 * Vive aparte de `onevid-profile.ts` porque ese módulo importa la base de
 * datos (`pg`) y no se puede usar desde componentes de cliente.
 */

export const PROFILE_AVATARS = [
  "black",
  "blue",
  "green",
  "orange",
  "purple",
  "red",
] as const;

export type ProfileAvatar = (typeof PROFILE_AVATARS)[number];

/**
 * Stickers de `stick-it-up` que también se pueden usar como avatar. El valor
 * guardado es `sticker:<id>`; los avatares antiguos (claves de gradiente) se
 * mantienen tal cual para no romper perfiles existentes.
 */
export const STICKER_AVATAR_IDS = [
  "flame",
  "metal",
  "blob-burst",
  "star-burst",
  "devil-cone",
  "flame-star",
  "folded-paper",
  "red-berry",
  "blueberry",
  "berries",
  "badge-smiley",
  "cosmic-pill",
  "red-cat",
  "pink-cat",
  "pink-cat-stamp",
  "yellow-cat",
  "black-cat",
  "cat",
  "cat-serious",
  "dog",
  "face",
  "black-face",
  "flower",
  "peace-hand",
  "sparkles",
  "sparkle-trio",
  "cosmic-eye",
  "curious-globe",
  "spiral",
  "eye-splat",
  "japan-badge",
  "cone",
  "icy-fleur",
  "app-badge",
  "bunny",
  "cat-sit",
  "fish",
  "luffy-hat",
  "coffee",
  "japan-flag",
  "cat-cute",
  "cherry",
  "goo",
  "heart",
  "nazar",
  "bad-cat",
  "nori-coffee",
  "nori-cool",
  "nori-headphones",
  "nori-heart",
  "nori-laptop",
  "nori-rocket",
  "pip-coffee",
  "pip-detective",
  "pip-headphones",
  "pip-rocket",
  "pip-thinking",
  "pip-wizard",
  "kuro-coffee",
  "kuro-cool",
  "kuro-headphones",
  "kuro-heart",
  "kuro-laptop",
  "kuro-rocket",
  "mochi-coffee",
  "mochi-cool",
  "mochi-headphones",
  "mochi-heart",
  "mochi-laptop",
  "mochi-rocket",
] as const;

export type StickerAvatarId = (typeof STICKER_AVATAR_IDS)[number];

export const STICKER_AVATAR_PREFIX = "sticker:";

export function stickerAvatarValue(id: string): string {
  return `${STICKER_AVATAR_PREFIX}${id}`;
}

export function stickerAvatarId(
  value: unknown
): StickerAvatarId | null {
  if (typeof value !== "string") return null;
  if (!value.startsWith(STICKER_AVATAR_PREFIX)) return null;
  const id = value.slice(STICKER_AVATAR_PREFIX.length);
  return (STICKER_AVATAR_IDS as readonly string[]).includes(id)
    ? (id as StickerAvatarId)
    : null;
}

export function isValidAvatar(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if ((PROFILE_AVATARS as readonly string[]).includes(value)) return true;
  return stickerAvatarId(value) !== null;
}
