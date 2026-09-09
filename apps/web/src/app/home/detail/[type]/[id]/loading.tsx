import { Skeleton } from "@workspace/ui/components/skeleton";
import { DetailScrollContainer } from "@/components/stream/detail-scroll-container";

/**
 * Shown immediately when navigating to /home/detail/[type]/[id].
 * Mirrors the background-fill layout of StreamOnevid so the transition
 * feels seamless.
 */
export default function DetailLoading() {
  return (
    <main className="mx-auto flex h-dvh w-full max-w-7xl flex-1 flex-col overflow-hidden border-border border-x border-dashed bg-background px-4 pt-0 pb-6 md:px-6">
      <div className="flex h-full min-h-0 flex-1 flex-col">
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
            <Skeleton className="size-8 rounded-full" />
          </div>
        </header>

        <DetailScrollContainer>
          <div className="-mt-4">
            <section className="relative mb-2 aspect-video min-h-56 w-full overflow-hidden rounded-(--radius) border border-border/70 bg-muted shadow-md shadow-zinc-950/30 md:aspect-[21/9] md:min-h-96">
              <Skeleton className="absolute inset-0 rounded-none" />
              <div className="absolute inset-0 bg-gradient-to-t from-background via-background/10 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 flex flex-col items-start gap-3 p-5 md:p-10">
                <Skeleton className="h-14 w-64 rounded-md md:h-20 md:w-96" />
                <Skeleton className="h-5 w-full max-w-2xl rounded-md" />
                <Skeleton className="h-5 w-3/4 max-w-2xl rounded-md" />
                <div className="flex gap-2">
                  <Skeleton className="h-8 w-28 rounded-md" />
                  <Skeleton className="h-8 w-24 rounded-md" />
                  <Skeleton className="h-8 w-28 rounded-md" />
                  <Skeleton className="h-8 w-20 rounded-md" />
                </div>
              </div>
            </section>
            </div>

          <div className="space-y-4 pt-6">
            <div className="flex items-center justify-between gap-3">
              <Skeleton className="h-5 w-44 rounded-md" />
              <Skeleton className="h-8 w-44 rounded-md" />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }, (_, i) => (
                <div
                  className="rounded-(--radius) border border-border/70 bg-muted/40 p-1"
                  key={i}
                >
                  <Skeleton className="aspect-video w-full rounded-[calc(var(--radius)-4px)]" />
                  <div className="space-y-2 p-3">
                    <Skeleton className="h-4 w-4/5 rounded-md" />
                    <Skeleton className="h-3 w-1/3 rounded-md" />
                    <Skeleton className="h-3 w-full rounded-md" />
                    <Skeleton className="h-3 w-2/3 rounded-md" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </DetailScrollContainer>
      </div>
    </main>
  );
}
