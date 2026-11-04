"use client";

import { buttonVariants } from "@workspace/ui/components/button";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { cn } from "@workspace/ui/lib/utils";
import { TvIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { LiveTvChannel } from "@/lib/live-tv";
import type { FeedSection } from "@/lib/onevid-feed-sections";

const LIVE_ROW_CHANNEL_LIMIT = 4;

function safeLogo(logo?: string): string | undefined {
  try {
    const url = new URL(logo ?? "");
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

function ChannelCard({
  channel,
  sourceId,
}: {
  channel: LiveTvChannel;
  sourceId?: string;
}) {
  const logo = safeLogo(channel.logo);
  const query = new URLSearchParams({
    surface: "live",
    source: sourceId ?? "",
    channel: channel.id,
  });
  if (channel.group) query.set("group", channel.group);
  const href = `/home?${query.toString()}`;
  return (
    <Link
      className="group/channel block w-full text-left outline-none"
      data-dpad-focusable
      href={href}
    >
      <span className="relative block aspect-video w-full rounded-(--radius) border border-border/70 bg-muted/40 p-1 transition-[border-color,box-shadow,filter] duration-200 group-hover/channel:border-primary group-focus-visible/channel:border-primary">
        <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-[calc(var(--radius)-4px)] border border-border/60 bg-card">
          {logo ? (
            // Provider logos are remote and must not pass through the image optimizer.
            // biome-ignore lint/performance/noImgElement: provider logos are remote and bypass the Next.js image optimizer.
            <img
              alt=""
              className="size-full object-contain p-2"
              height={90}
              loading="lazy"
              referrerPolicy="no-referrer"
              src={logo}
              width={160}
            />
          ) : (
            <TvIcon aria-hidden="true" className="size-6 text-muted-foreground" />
          )}
        </span>
      </span>
      <span className="block space-y-1 px-1 pt-2 pb-1 text-center">
        <span className="line-clamp-2 font-medium text-sm leading-tight md:text-base">
          {channel.name}
        </span>
        <span className="block truncate text-[10px] text-muted-foreground">
          {channel.group}
        </span>
      </span>
    </Link>
  );
}

/** Carrusel de canales de Live TV para las filas del feed de Inicio/Descubrir. */
export function LiveTvFeedRow({ section }: { section: FeedSection }) {
  const [channels, setChannels] = useState<LiveTvChannel[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const sourceId = section.liveSourceId;
    if (!sourceId) {
      setFailed(true);
      return;
    }
    const group = section.liveGroup;
    const controller = new AbortController();
    let active = true;
    setChannels(null);
    setFailed(false);
    const query = new URLSearchParams({ sourceId });
    if (group) query.set("group", group);
    query.set("limit", String(LIVE_ROW_CHANNEL_LIMIT));
    fetch(`/api/onevid-live-tv/channels?${query.toString()}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error("Live TV unavailable");
        return response.json();
      })
      .then((data: { channels?: LiveTvChannel[] }) => {
        if (!active) return;
        if (!Array.isArray(data.channels)) {
          setFailed(true);
          return;
        }
        setChannels(data.channels.slice(0, LIVE_ROW_CHANNEL_LIMIT));
      })
      .catch(() => {
        if (active && !controller.signal.aborted) setFailed(true);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [section.liveGroup, section.liveSourceId]);

  return (
    <section className="container mx-auto flex flex-col gap-3 px-2">
      <div className="flex items-baseline justify-between gap-2 px-1">
        <h2 className="font-semibold text-lg md:text-xl">{section.title}</h2>
        {section.href ? (
          <Link
            className={cn(
              buttonVariants({ size: "xs" }),
              "btn-primary shrink-0",
            )}
            data-dpad-focusable
            href={section.href}
          >
            Ver todo
          </Link>
        ) : null}
      </div>

      {failed ? (
        <p className="px-1 text-muted-foreground text-sm">
          No se pudieron cargar los canales de Live TV.
        </p>
      ) : channels === null ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div className="space-y-1.5" key={index}>
              <Skeleton className="aspect-video w-full rounded-lg" />
              <Skeleton className="h-3 w-3/4" />
            </div>
          ))}
        </div>
      ) : channels.length === 0 ? (
        <p className="px-1 text-muted-foreground text-sm">
          Esta fuente no tiene canales.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
          {channels.map((channel) => (
            <ChannelCard
              channel={channel}
              key={channel.id}
              sourceId={section.liveSourceId}
            />
          ))}
        </div>
      )}
    </section>
  );
}
