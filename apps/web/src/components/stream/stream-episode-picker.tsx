"use client";

import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@workspace/ui/components/drawer";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { CheckCircle2Icon, ListVideoIcon, Loader } from "lucide-react";
import { useEffect, useState } from "react";
import type { NextEpisodeRef } from "@/components/stream/stream-next-episode";
import { tmdbImage } from "@/lib/tmdb";
import type { StreamWithAddon } from "@/types/stream";

interface EpisodePickerProps {
  poster?: string;
  seriesId: string;
  season: number;
  episode: number;
  onSelect: (episode: NextEpisodeRef, source: StreamWithAddon) => void;
}

interface SeasonMeta {
  episodes?: EpisodeMeta[];
  seasons?: number[];
}

interface EpisodeMeta {
  name?: string;
  number?: number;
  season?: number;
  thumbnail?: string;
}

export function StreamEpisodePicker({
  seriesId,
  season,
  episode,
  poster,
  onSelect,
}: EpisodePickerProps) {
  const [open, setOpen] = useState(false);
  const [episodes, setEpisodes] = useState<NextEpisodeRef[]>([]);
  const [seasons, setSeasons] = useState<number[]>([]);
  const [selectedSeason, setSelectedSeason] = useState(season);
  const [loading, setLoading] = useState(false);
  const [selecting, setSelecting] = useState<number | null>(null);

  useEffect(() => {
    if (!open || !seriesId || selectedSeason < 1) {
      return;
    }
    let active = true;
    setLoading(true);
    fetch(
      `/api/series-meta?id=${encodeURIComponent(seriesId)}&season=${selectedSeason}`
    )
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(String(response.status));
        }
        return (await response.json()) as SeasonMeta;
      })
      .then((data) => {
        if (!active) {
          return;
        }
        setSeasons(data.seasons ?? []);
        setEpisodes(
          (data.episodes ?? [])
            .filter(
            (item): item is EpisodeMeta & { number: number } =>
                item.season === selectedSeason &&
                typeof item.number === "number" &&
                item.number > 0
            )
            .sort((a, b) => a.number - b.number)
            .map((item) => ({
              playId: `${seriesId}:${selectedSeason}:${item.number}`,
              episode: item.number,
              name: item.name ?? "",
              season: selectedSeason,
              thumbnail: item.thumbnail,
            }))
        );
        setLoading(false);
      })
      .catch(() => {
        if (active) {
          setEpisodes([]);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [open, selectedSeason, seriesId]);

  useEffect(() => {
    if (open) {
      setSelectedSeason(season);
    }
  }, [open, season]);

  const handleSelect = async (item: NextEpisodeRef) => {
    if (selecting !== null || item.episode === episode) {
      return;
    }
    setSelecting(item.episode);
    try {
      const response = await fetch("/api/stream/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.playId, type: "series" }),
      });
      if (!response.ok) {
        throw new Error(String(response.status));
      }
      const data = (await response.json()) as { sources?: StreamWithAddon[] };
      const source = data.sources?.[0];
      if (!source) {
        throw new Error("No hay medios");
      }
      onSelect(item, source);
      setOpen(false);
    } catch {
      setSelecting(null);
    }
  };

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              aria-label="Cambiar episodio"
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-sm transition-colors hover:bg-white/20"
              onClick={() => setOpen(true)}
              type="button"
            />
          }
        >
          <ListVideoIcon className="size-5" />
        </TooltipTrigger>
        <TooltipContent>Episodios</TooltipContent>
      </Tooltip>

      <Drawer onOpenChange={setOpen} open={open} swipeDirection="right">
        <DrawerContent>
          <DrawerHeader>
            <div className="flex items-center justify-between gap-3">
              <DrawerTitle>Episodios</DrawerTitle>
              <Select
                onValueChange={(value) => {
                  if (!value) {
                    return;
                  }
                  setSelectedSeason(Number(value));
                  setEpisodes([]);
                }}
                value={selectedSeason}
              >
                <SelectTrigger className="h-8 w-auto min-w-0 rounded-lg bg-background px-2.5 text-xs">
                  <SelectValue>Temporada {selectedSeason}</SelectValue>
                </SelectTrigger>
                <SelectContent
                  align="end"
                  className="max-h-64 w-auto min-w-36 rounded-lg"
                  side="bottom"
                >
                  {seasons.map((item) => (
                    <SelectItem
                      className="rounded-md py-1.5 text-xs"
                      key={item}
                      value={String(item)}
                    >
                      Temporada {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </DrawerHeader>
          <div className="no-scrollbar min-h-0 flex-1 space-y-1.5 overflow-y-auto px-4 pt-3 pb-4">
            {loading && (
              <div className="flex justify-center py-6">
                <Loader className="size-4 animate-spin" />
              </div>
            )}
            {!loading &&
              episodes.map((item) => (
                <button
                  className="flex w-full items-center gap-3 rounded-lg border border-border/50 p-2 text-left transition-colors hover:bg-accent disabled:opacity-60"
                  disabled={selecting !== null || item.episode === episode}
                  key={item.playId}
                  onClick={() => void handleSelect(item)}
                  type="button"
                >
                  {item.thumbnail || poster ? (
                    // biome-ignore lint/performance/noImgElement: external TMDB episode thumbnail
                    <img
                      alt=""
                      className="h-12 w-20 shrink-0 rounded object-cover"
                      height={48}
                      loading="lazy"
                      src={
                        tmdbImage(item.thumbnail ?? poster, "w300") ??
                        item.thumbnail ??
                        poster ??
                        ""
                      }
                      width={80}
                    />
                  ) : (
                    <span className="flex h-12 w-20 shrink-0 items-center justify-center rounded bg-muted font-semibold text-sm">
                      {item.episode}
                    </span>
                  )}
                  <span className="font-semibold text-sm">{item.episode}</span>
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {item.name || `Episodio ${item.episode}`}
                  </span>
                  {selecting === item.episode && (
                    <Loader className="size-4 animate-spin" />
                  )}
                  {item.season === season && item.episode === episode && (
                    <CheckCircle2Icon className="size-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  )}
                </button>
              ))}
            {!loading && episodes.length === 0 && (
              <p className="py-6 text-center text-muted-foreground text-sm">
                No hay episodios disponibles.
              </p>
            )}
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}
