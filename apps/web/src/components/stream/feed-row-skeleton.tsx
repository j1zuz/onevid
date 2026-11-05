import { Skeleton } from "@workspace/ui/components/skeleton";
import { FEED_ROW_ITEM_LIMIT } from "@/lib/onevid-feed";

const ROW_CLASS =
  "no-scrollbar -mx-2 flex snap-x snap-mandatory gap-4 overflow-x-auto px-2 pb-1";
const ITEM_CLASS = "w-64 shrink-0 snap-start sm:w-72";

/** Esqueleto de una fila del feed (compatible con server y client). */
export function FeedRowSkeleton() {
  return (
    <section className="flex flex-col gap-3 px-2">
      <Skeleton className="h-7 w-40" />
      <div className={ROW_CLASS}>
        {Array.from({ length: FEED_ROW_ITEM_LIMIT }).map((_, index) => (
          <div className={ITEM_CLASS} key={`feed-skeleton-${index}`}>
            <Skeleton className="aspect-video w-full rounded-(--radius)" />
          </div>
        ))}
      </div>
    </section>
  );
}
