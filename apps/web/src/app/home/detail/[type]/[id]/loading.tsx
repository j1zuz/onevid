import { Skeleton } from "@workspace/ui/components/skeleton";

/**
 * Shown immediately when navigating to /home/detail/[type]/[id].
 * Mirrors the background-fill layout of StreamOnevid so the transition
 * feels seamless.
 */
export default function DetailLoading() {
  return (
    <div className="group/player relative flex h-dvh w-full flex-col overflow-hidden bg-gray-950">
      <Skeleton className="absolute inset-0 rounded-none opacity-40" />

      <div className="absolute inset-x-0 top-0 z-10 flex items-center gap-3 bg-gradient-to-b from-black/70 to-transparent px-4 py-3 opacity-0 transition-opacity duration-300 group-hover/player:opacity-100">
        <Skeleton className="size-9 rounded-full" />
        <Skeleton className="h-5 w-40 rounded-md" />
      </div>

      <div className="relative z-10 flex min-h-0 w-full flex-1 items-center justify-center bg-black/30">
        <Skeleton className="h-12 w-56 rounded-md opacity-80 md:h-20 md:w-96" />
      </div>
    </div>
  );
}
