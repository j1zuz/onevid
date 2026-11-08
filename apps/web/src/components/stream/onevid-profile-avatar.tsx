"use client";

import { cn } from "@workspace/ui/lib/utils";
import { Sticker, type StickerName } from "stick-it-up";
import { stickerAvatarId } from "@/lib/onevid-avatars";

const AVATAR_KEYS = ["black", "blue", "green", "orange", "purple", "red"];

/** Resolve a profile avatar key to its gradient image in /public/avatar. */
export function avatarImageSrc(avatar: string): string {
  const key = AVATAR_KEYS.includes(avatar) ? avatar : "blue";
  return `/avatar/${key}.jpg`;
}

/**
 * Avatar de perfil. Puede ser una de las claves de gradiente de siempre o un
 * sticker de `stick-it-up` guardado como `sticker:<id>`.
 */
export function OneVidProfileAvatar({
  avatar,
  name,
  className,
}: {
  avatar: string;
  className?: string;
  name: string;
}) {
  const sticker = stickerAvatarId(avatar);

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center overflow-hidden rounded-full",
        className
      )}
    >
      {sticker ? (
        <Sticker name={sticker as StickerName} size="100%" />
      ) : (
        // biome-ignore lint/performance/noImgElement: small local static asset
        <img
          alt={name}
          className="size-full object-cover"
          src={avatarImageSrc(avatar)}
        />
      )}
    </span>
  );
}
