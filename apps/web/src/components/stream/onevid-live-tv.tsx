"use client";

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@workspace/ui/components/native-select";
import { Skeleton } from "@workspace/ui/components/skeleton";
import {
  AlertCircleIcon,
  RadioIcon,
  RefreshCwIcon,
  SearchIcon,
  Settings2Icon,
  TvIcon,
  XIcon,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useDeferredValue, useEffect, useId, useMemo, useState } from "react";
import {
  LIVE_TV_MAX_CHANNELS,
  type LiveTvChannel,
  type LiveTvSourceSummary,
} from "@/lib/live-tv";
import { LiveTvGuide } from "./live-tv-guide";

const LiveTvPlayer = dynamic(
  () => import("./live-tv-player").then((module) => module.LiveTvPlayer),
  {
    ssr: false,
    loading: () => (
      <Skeleton
        aria-label="Cargando reproductor"
        className="aspect-video w-full rounded-none"
      />
    ),
  },
);

type RequestState<T> =
  | { status: "loading"; data?: never }
  | { status: "error"; data?: never }
  | { status: "ready"; data: T };

function useLiveTvRequest<T>(path: string) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<RequestState<T>>({ status: "loading" });
  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is a retry trigger, not read inside the effect.
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timeout = window.setTimeout(() => controller.abort(), 45_000);
    setState({ status: "loading" });
    async function load() {
      try {
        const response = await fetch(path, {
          signal: controller.signal,
          cache: "no-store",
          headers: { Accept: "application/json" },
        });
        if (!response.ok) throw new Error("Live TV unavailable");
        const data: T = await response.json();
        if (active) setState({ status: "ready", data });
      } catch {
        if (active) setState({ status: "error" });
      } finally {
        window.clearTimeout(timeout);
      }
    }
    void load();
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [path, attempt]);
  return { ...state, retry: () => setAttempt((value) => value + 1) };
}

function RequestError({ onRetry }: { onRetry: () => void }) {
  return (
    <Alert>
      <AlertCircleIcon aria-hidden="true" />
      <AlertTitle>No se pudo cargar Live TV</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>Comprueba tu conexión y que la fuente siga disponible.</p>
        <Button
          data-dpad-focusable
          onClick={onRetry}
          size="sm"
          variant="outline"
        >
          <RefreshCwIcon aria-hidden="true" className="size-3.5" />
          Reintentar
        </Button>
      </AlertDescription>
    </Alert>
  );
}

function GuideSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border bg-card" role="status">
      <span className="sr-only">Cargando canales de Live TV...</span>
      <div aria-hidden="true" className="space-y-1 p-3">
        <Skeleton className="mb-4 h-8 w-1/3" />
        {Array.from({ length: 6 }, (_, index) => (
          <div className="flex gap-1" key={index}>
            <Skeleton className="h-16 w-28 shrink-0" />
            <Skeleton className="h-16 flex-1" />
            <Skeleton className="h-16 flex-1" />
          </div>
        ))}
      </div>
    </div>
  );
}

function ChannelBrowser({ source }: { source: LiveTvSourceSummary }) {
  const request = useLiveTvRequest<{ channels: LiveTvChannel[] }>(
    `/api/onevid-live-tv/channels?sourceId=${encodeURIComponent(source.id)}`,
  );
  const searchId = useId();
  const groupId = useId();
  const [search, setSearch] = useState(() => {
    if (typeof window !== "undefined") {
      const input = document.getElementById(searchId);
      if (input instanceof HTMLInputElement) return input.value;
    }
    return "";
  });
  const [group, setGroup] = useState("");
  const [selected, setSelected] = useState<LiveTvChannel | null>(null);
  const deferredSearch = useDeferredValue(search);
  const channels = useMemo(
    () =>
      request.status === "ready" && Array.isArray(request.data.channels)
        ? request.data.channels.slice(0, LIVE_TV_MAX_CHANNELS)
        : [],
    [request.status, request.data],
  );
  const groups = useMemo(
    () =>
      [...new Set(channels.map((channel) => channel.group))]
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b)),
    [channels],
  );
  const filtered = useMemo(() => {
    const query = deferredSearch.trim().toLocaleLowerCase();
    return channels.filter(
      (channel) =>
        (!group || channel.group === group) &&
        (!query || channel.name.toLocaleLowerCase().includes(query)),
    );
  }, [channels, deferredSearch, group]);

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 basis-48 space-y-1.5">
          <Label className="sr-only" htmlFor={searchId}>
            Buscar canal
          </Label>
          <div className="relative">
            <SearchIcon
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              autoComplete="off"
              className="pl-9"
              data-dpad-focusable
              id={searchId}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar canal..."
              type="search"
              value={search}
            />
          </div>
        </div>
        <div className="min-w-0 basis-48 space-y-1.5">
          <Label className="sr-only" htmlFor={groupId}>
            Categoría
          </Label>
          <NativeSelect
            className="w-full"
            data-dpad-focusable
            id={groupId}
            onChange={(event) => setGroup(event.target.value)}
            value={group}
          >
            <NativeSelectOption value="">
              Todas las categorías
            </NativeSelectOption>
            {groups.map((name) => (
              <NativeSelectOption key={name} value={name}>
                {name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        {request.status === "ready" ? (
          <Badge className="mb-1" variant="outline">
            {filtered.length} canales
          </Badge>
        ) : null}
      </div>

      {selected ? (
        <section
          aria-label="Canal en reproducción"
          className="overflow-hidden rounded-xl border bg-card lg:grid lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]"
        >
          <div className="min-w-0 bg-black">
            <LiveTvPlayer channel={selected} key={selected.id} />
          </div>
          <div className="flex min-w-0 flex-col gap-3 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1.5">
                <Badge variant="secondary">
                  <RadioIcon aria-hidden="true" className="size-3" />
                  En directo
                </Badge>
                <h2 className="truncate text-lg font-semibold">
                  {selected.name}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {selected.group}
                </p>
              </div>
              <Button
                aria-label="Cerrar reproductor"
                data-dpad-focusable
                onClick={() => setSelected(null)}
                size="icon-sm"
                variant="ghost"
              >
                <XIcon aria-hidden="true" />
              </Button>
            </div>
            <p className="mt-auto text-xs leading-relaxed text-muted-foreground">
              Elige otro canal en la parrilla para cambiar la reproducción. Los
              horarios de la guía se muestran en tu zona horaria.
            </p>
          </div>
        </section>
      ) : null}

      {request.status === "loading" ? (
        <GuideSkeleton />
      ) : request.status === "error" ? (
        <RequestError onRetry={request.retry} />
      ) : !channels.length ? (
        <Empty className="border bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <TvIcon />
            </EmptyMedia>
            <EmptyTitle>No hay canales disponibles</EmptyTitle>
            <EmptyDescription>
              Esta fuente no devolvió canales compatibles. Comprueba su
              configuración o actualiza la lista.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              data-dpad-focusable
              onClick={request.retry}
              size="sm"
              variant="outline"
            >
              Actualizar canales
            </Button>
          </EmptyContent>
        </Empty>
      ) : !filtered.length ? (
        <Empty className="border bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchIcon />
            </EmptyMedia>
            <EmptyTitle>No hay coincidencias</EmptyTitle>
            <EmptyDescription>
              Prueba otro nombre de canal o categoría.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              data-dpad-focusable
              onClick={() => {
                setSearch("");
                setGroup("");
              }}
              size="sm"
              variant="outline"
            >
              Limpiar filtros
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <LiveTvGuide
          channels={filtered}
          key={JSON.stringify([
            source.id,
            group,
            deferredSearch.trim().toLocaleLowerCase(),
          ])}
          onChannelSelect={setSelected}
          selectedChannelId={selected?.id}
          source={source}
        />
      )}
    </div>
  );
}

export function OneVidLiveTv() {
  const request = useLiveTvRequest<{ sources: LiveTvSourceSummary[] }>(
    "/api/onevid-live-tv",
  );
  const [sourceId, setSourceId] = useState("");
  const selectorId = useId();
  const sources =
    request.status === "ready" && Array.isArray(request.data.sources)
      ? request.data.sources
      : [];
  const source = sources.find((item) => item.id === sourceId) || sources[0];
  return (
    <section
      aria-label="Live TV"
      className="min-w-0 space-y-4 pb-4 text-foreground"
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-lg border bg-card">
            <RadioIcon aria-hidden="true" className="size-4 text-primary" />
          </span>
          <div>
            <h1 className="text-lg font-semibold">Live TV</h1>
            <p className="text-xs text-muted-foreground">
              Canales y programación en directo
            </p>
          </div>
        </div>
        {source ? (
          <div className="min-w-0 basis-full sm:basis-52">
            <Label className="sr-only" htmlFor={selectorId}>
              Fuente de Live TV
            </Label>
            <NativeSelect
              className="w-full"
              data-dpad-focusable
              id={selectorId}
              onChange={(event) => setSourceId(event.target.value)}
              value={source.id}
            >
              {sources.map((item) => (
                <NativeSelectOption key={item.id} value={item.id}>
                  {item.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
        ) : null}
        <Button
          data-dpad-focusable
          render={<Link href="/home/account?view=catalog" />}
          size="sm"
          variant="outline"
        >
          <Settings2Icon aria-hidden="true" className="size-3.5" />
          Configurar Live TV
        </Button>
      </div>
      {request.status === "loading" ? (
        <GuideSkeleton />
      ) : request.status === "error" ? (
        <RequestError onRetry={request.retry} />
      ) : !sources.length ? (
        <Empty className="border bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <TvIcon />
            </EmptyMedia>
            <EmptyTitle>Conecta tus canales</EmptyTitle>
            <EmptyDescription>
              Añade una lista M3U o una cuenta Xtream Codes para ver sus canales
              y programación.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="flex-row flex-wrap justify-center">
            <Button
              data-dpad-focusable
              render={<Link href="/home/account?view=catalog" />}
              size="sm"
            >
              Configurar Live TV
            </Button>
            <Button
              data-dpad-focusable
              onClick={request.retry}
              size="sm"
              variant="outline"
            >
              Actualizar
            </Button>
          </EmptyContent>
        </Empty>
      ) : source ? (
        <ChannelBrowser key={source.id} source={source} />
      ) : null}
    </section>
  );
}
