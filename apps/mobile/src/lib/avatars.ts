import { stickerSource } from './stickers';

export type AvatarKey =
  | 'blue'
  | 'green'
  | 'orange'
  | 'purple'
  | 'red'
  | 'black';

export const AVATAR_KEYS: AvatarKey[] = [
  'blue',
  'green',
  'orange',
  'purple',
  'red',
  'black',
];

const SOURCES: Record<AvatarKey, number> = {
  blue: require('@/assets/images/avatars/blue.jpg'),
  green: require('@/assets/images/avatars/green.jpg'),
  orange: require('@/assets/images/avatars/orange.jpg'),
  purple: require('@/assets/images/avatars/purple.jpg'),
  red: require('@/assets/images/avatars/red.jpg'),
  black: require('@/assets/images/avatars/black.jpg'),
};

/** Prefijo con el que se guardan los avatares de sticker en el perfil. */
export const STICKER_AVATAR_PREFIX = 'sticker:';

/** Valor de avatar para un sticker (`sticker:<id>`). */
export function stickerAvatarValue(id: string): string {
  return `${STICKER_AVATAR_PREFIX}${id}`;
}

/**
 * Id del sticker si el avatar lo es, o null si es una clave de gradiente.
 * (No valida contra la lista: de eso se encarga `stickerSource`.)
 */
export function stickerAvatarId(value: string | undefined): string | null {
  if (!value?.startsWith(STICKER_AVATAR_PREFIX)) return null;
  return value.slice(STICKER_AVATAR_PREFIX.length) || null;
}

/**
 * Imagen local del avatar: los 6 gradientes de siempre o un sticker de
 * `stick-it-up` (rasterizado en assets). Cualquier valor desconocido cae al
 * gradiente negro para no romper perfiles antiguos.
 */
export function avatarSource(key: string | undefined): number {
  const sticker = stickerAvatarId(key);
  if (sticker) return stickerSource(sticker) ?? SOURCES.black;
  return SOURCES[(key as AvatarKey) in SOURCES ? (key as AvatarKey) : 'black'];
}
