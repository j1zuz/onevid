"use client";

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert";
import { Button } from "@workspace/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty";
import { Label } from "@workspace/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { Skeleton } from "@workspace/ui/components/skeleton";
import {
  AlertCircleIcon,
  RadioIcon,
  RefreshCwIcon,
  Settings2Icon,
  TvIcon,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useDeferredValue, useEffect, useId, useMemo, useState } from "react";
import {
  LIVE_TV_MAX_CHANNELS,
  type LiveTvChannel,
  type LiveTvSourceSummary,
} from "@/lib/live-tv";
import { useTranslation } from "@/lib/onevid-i18n-context";
import { LiveTvGuide } from "./live-tv-guide";
import { useLiveTvSearch } from "./live-tv-search";

function PlayerSkeleton() {
  const { t: rawT } = useTranslation();
  return (
    <Skeleton
      aria-label={rawT("Cargando reproductor" as never) as unknown as string}
      className="aspect-video w-full rounded-none"
    />
  );
}

const LiveTvPlayer = dynamic(
  () => import("./live-tv-player").then((module) => module.LiveTvPlayer),
  {
    ssr: false,
    loading: () => <PlayerSkeleton />,
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
  const { t: rawT } = useTranslation();
  const t = (key: string) => rawT(key as never) as unknown as string;
  return (
    <Alert>
      <AlertCircleIcon aria-hidden="true" />
      <AlertTitle>{t("No se pudo cargar Live TV")}</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>{t("Comprueba tu conexión y que la fuente siga disponible.")}</p>
        <Button
          data-dpad-focusable
          onClick={onRetry}
          size="sm"
          variant="outline"
        >
          <RefreshCwIcon aria-hidden="true" className="size-3.5" />
          {t("Reintentar")}
        </Button>
      </AlertDescription>
    </Alert>
  );
}

function GuideSkeleton() {
  const { t: rawT } = useTranslation();
  return (
    <div className="overflow-hidden rounded-xl border bg-card" role="status">
      <span className="sr-only">
        {rawT("Cargando canales de Live TV..." as never) as unknown as string}
      </span>
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

function ChannelBrowser({
  source,
  initialChannelId,
  initialGroup,
}: {
  source: LiveTvSourceSummary;
  initialChannelId?: string | null;
  initialGroup?: string | null;
}) {
  const { t: rawT } = useTranslation();
  const t = (key: string) => rawT(key as never) as unknown as string;
  const request = useLiveTvRequest<{ channels: LiveTvChannel[] }>(
    `/api/onevid-live-tv/channels?sourceId=${encodeURIComponent(source.id)}`,
  );
  const liveSearch = useLiveTvSearch();
  const search = liveSearch?.query ?? "";
  const [group, setGroup] = useState(initialGroup ?? "");
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

  // Si venimos de una fila de Live TV del feed, abrimos ese canal directamente.
  useEffect(() => {
    if (!initialChannelId || !channels.length) return;
    setSelected(
      (current) =>
        current ?? channels.find((channel) => channel.id === initialChannelId) ?? null,
    );
  }, [channels, initialChannelId]);

  // Y dejamos seleccionada la categoría desde la que venía la fila.
  useEffect(() => {
    if (initialGroup == null) return;
    setGroup((current) => current || initialGroup);
  }, [initialGroup]);

  return (
    <div className="min-w-0 space-y-4">
      {selected ? (
        <section
          aria-label={t("Canal en reproducción")}
          className="relative min-w-0 overflow-hidden rounded-xl border border-border bg-black"
        >
          <div className="min-w-0">
            <LiveTvPlayer channel={selected} key={selected.id} />
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
            <EmptyTitle>{t("No hay canales disponibles")}</EmptyTitle>
            <EmptyDescription>
              {t(
                "Esta fuente no devolvió canales compatibles. Comprueba su configuración o actualiza la lista.",
              )}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              data-dpad-focusable
              onClick={request.retry}
              size="sm"
              variant="outline"
            >
              {t("Actualizar canales")}
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <LiveTvGuide
          channels={filtered}
          group={group}
          groups={groups}
          key={JSON.stringify([
            source.id,
            group,
            deferredSearch.trim().toLocaleLowerCase(),
          ])}
          onChannelSelect={setSelected}
          onGroupChange={setGroup}
          selectedChannelId={selected?.id}
          source={source}
        />
      )}
    </div>
  );
}

export function OneVidLiveTv() {
  const { t: rawT } = useTranslation();
  const t = (key: string) => rawT(key as never) as unknown as string;
  const request = useLiveTvRequest<{ sources: LiveTvSourceSummary[] }>(
    "/api/onevid-live-tv",
  );
  const [sourceId, setSourceId] = useState("");
  const [requestedChannelId, setRequestedChannelId] = useState<string | null>(
    null,
  );
  const [requestedGroup, setRequestedGroup] = useState<string | null>(null);
  const selectorId = useId();
  const sources =
    request.status === "ready" && Array.isArray(request.data.sources)
      ? request.data.sources
      : [];
  const source = sources.find((item) => item.id === sourceId) || sources[0];

  // Las filas de Live TV del feed enlazan con ?source=…&channel=… para abrir
  // directamente ese canal en esta pantalla.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sourceParam = params.get("source");
    if (sourceParam) setSourceId(sourceParam);
    setRequestedChannelId(params.get("channel"));
    setRequestedGroup(params.get("group"));
  }, []);
  return (
    <section
      aria-label={t("Live TV")}
      className="min-w-0 space-y-4 pb-4 text-foreground"
    >
      {sources.length > 1 && source ? (
        <div className="flex justify-end">
          <div className="min-w-0 w-full sm:w-52">
            <Label className="sr-only" htmlFor={selectorId}>
              {t("Fuente de Live TV")}
            </Label>
            <Select
              items={sources.map((item) => ({
                value: item.id,
                label: item.name,
              }))}
              onValueChange={(value) => {
                if (value) setSourceId(value);
              }}
              value={source.id}
            >
              <SelectTrigger
                className="w-full"
                data-dpad-focusable
                id={selectorId}
                size="sm"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sources.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      ) : null}
      {request.status === "loading" ? (
        <GuideSkeleton />
      ) : request.status === "error" ? (
        <RequestError onRetry={request.retry} />
      ) : !sources.length ? (
        <Empty className="border-0">
          <EmptyHeader>
            <EmptyMedia className="size-9 rounded-lg border bg-card">
              <RadioIcon
                aria-hidden="true"
                className="size-4 text-primary"
              />
            </EmptyMedia>
            <EmptyTitle>{t("Live TV")}</EmptyTitle>
          </EmptyHeader>
          <EmptyContent>
            <Button
              data-dpad-focusable
              nativeButton={false}
              render={<Link href="/home/account?view=catalog" />}
              size="sm"
              variant="outline"
            >
              <Settings2Icon aria-hidden="true" className="size-3.5" />
              {t("Configurar Live TV")}
            </Button>
          </EmptyContent>
        </Empty>
      ) : source ? (
        <ChannelBrowser
          initialChannelId={requestedChannelId}
          initialGroup={requestedGroup}
          key={source.id}
          source={source}
        />
      ) : null}
    </section>
  );
}
