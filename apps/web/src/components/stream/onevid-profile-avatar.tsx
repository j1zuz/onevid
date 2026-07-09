import { cn } from "@workspace/ui/lib/utils";

const AVATAR_KEYS = ["black", "blue", "green", "orange", "purple", "red"];

/** Resolve a profile avatar key to its gradient image in /public/avatar. */
export function avatarImageSrc(avatar: string): string {
  const key = AVATAR_KEYS.includes(avatar) ? avatar : "blue";
  return `/avatar/${key}.jpg`;
}

export function OneVidProfileAvatar({
  avatar,
  name,
  className,
}: {
  avatar: string;
  className?: string;
  name: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center overflow-hidden rounded-md",
        className
      )}
    >
      {/* biome-ignore lint/performance/noImgElement: small local static asset */}
      {/* biome-ignore lint/correctness/useImageSize: avatar scaled by CSS (size-full) */}
      <img
        alt={name}
        className="size-full object-cover"
        src={avatarImageSrc(avatar)}
      />
    </span>
  );
}
