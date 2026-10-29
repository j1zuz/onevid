import { Skeleton } from "@workspace/ui/components/skeleton";

/**
 * Next's automatic fallback for the /home route segment — shown the instant
 * you navigate here, while `OneVidPage` resolves the session + the lightweight
 * profile query that decides whether to show the "¿Quién está viendo?" gate
 * (see src/app/home/page.tsx). Deliberately neutral/blank instead of a
 * home-shaped skeleton: a gated profile should never get a glimpse of
 * anything that looks like it's already inside the app, even for a split
 * second, while that decision is still pending.
 */
export default function HomeLoading() {
  return <main className="h-dvh w-full bg-background" />;
}

/**
 * The actual home shell skeleton (header + hero + feed rows), used by
 * <OneVidPage>'s own inner <Suspense> once the gate decision is already
 * made and we're genuinely streaming in the TMDB-backed feed — not by the
 * route-level loading above, which runs before that decision exists.
 */
export function HomeFeedSkeleton() {
  return (
    <main className="mx-auto flex h-dvh w-full max-w-7xl flex-1 flex-col border-border border-x border-dashed bg-background px-4 pt-0 pb-6 md:px-6">
      <header className="-mx-4 mb-6 md:-mx-6 sticky top-0 z-20 flex items-center justify-between gap-4 border-border border-b border-dashed bg-background/95 px-4 py-3 backdrop-blur supports-backdrop-filter:bg-background/80 md:px-6">
        <div className="flex items-center gap-3">
          <Skeleton className="size-8 rounded-md" />
          <div className="flex items-center gap-1">
            <Skeleton className="h-7 w-14 rounded-full" />
            <Skeleton className="h-7 w-20 rounded-full" />
          </div>
        </div>
        <div className="flex flex-1 items-center justify-end gap-2">
          <Skeleton className="h-9 w-full max-w-xs rounded-md" />
          {/* Profile avatar */}
          <Skeleton className="size-8 rounded-full" />
        </div>
      </header>

      <div className="no-scrollbar flex min-h-0 flex-1 flex-col gap-8 overflow-hidden py-4">
        <div className="-mt-4">
          <Skeleton className="mb-2 aspect-[4/5] w-full rounded-(--radius) md:aspect-[21/9] md:min-h-96" />
        </div>
        <ContinueRowSkeleton />
        <FeedRowSkeleton />
        <FeedRowSkeleton />
        <FeedRowSkeleton />
      </div>
    </main>
  );
}

function ContinueRowSkeleton() {
  return (
    <section className="container mx-auto flex flex-col gap-3 px-2">
      <Skeleton className="h-6 w-40 rounded-md" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    </section>
  );
}

function FeedRowSkeleton() {
  return (
    <section className="container mx-auto flex flex-col gap-3 px-2">
      <div className="flex items-baseline justify-between gap-2 px-1">
        <Skeleton className="h-6 w-36 rounded-md" />
        <Skeleton className="h-7 w-20 rounded-md" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    </section>
  );
}

function CardSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="aspect-video w-full rounded-(--radius)" />
      <Skeleton className="mx-auto h-4 w-3/4 rounded-md" />
    </div>
  );
}
