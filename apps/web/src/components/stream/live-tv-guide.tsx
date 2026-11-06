"use client";

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog";
import { ScrollArea, ScrollBar } from "@workspace/ui/components/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { GlimmScope, type GlimmScopeHandle } from "glimm/next";
import {
  BookmarkIcon,
  CalendarDaysIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  HeartIcon,
  Loader,
  RefreshCcwDotIcon,
} from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type {
  LiveTvChannel,
  LiveTvGuideResponse,
  LiveTvGuideRow,
  LiveTvProgramme,
  LiveTvSourceSummary,
} from "@/lib/live-tv";
import { buildLiveSavedId } from "@/lib/live-tv-saved";
import { useTranslation } from "@/lib/onevid-i18n-context";
import { useOneVidProfiles } from "./onevid-profile-context";
import {
  getGuidePage,
  getGuideWindowStart,
  getProgrammeLayout,
  GUIDE_TICK_MS,
  GUIDE_WINDOW_MS,
} from "./live-tv-guide-layout";

type GuideState =
  | { key: string; status: "error"; timeout: boolean }
  | { key: string; status: "ready"; rows: Map<string, LiveTvGuideRow> };

const GUIDE_TIMEOUT_MS = 90_000;

async function fetchGuideRows(
  payload: string,
  signal?: AbortSignal,
): Promise<Map<string, LiveTvGuideRow>> {
  const response = await fetch("/api/onevid-live-tv/guide", {
    method: "POST",
    body: payload,
    signal,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  });
  if (!response.ok) throw new Error("Guide unavailable");
  const data: LiveTvGuideResponse = await response.json();
  if (
    !Array.isArray(data.channels) ||
    data.channels.some(
      (row) =>
        !row ||
        typeof row.channelId !== "string" ||
        !Array.isArray(row.programmes),
    )
  )
    throw new Error("Invalid guide");
  return new Map(data.channels.map((row) => [row.channelId, row]));
}

export interface LiveTvGuideProps {
  source: LiveTvSourceSummary;
  channels: LiveTvChannel[];
  group: string;
  groups: string[];
  onGroupChange: (group: string) => void;
  selectedChannelId?: string;
  onChannelSelect: (channel: LiveTvChannel) => void;
}

function ChannelIdentity({ channel }: { channel: LiveTvChannel }) {
  const [failed, setFailed] = useState(false);
  let logo: string | undefined;
  try {
    const url = new URL(channel.logo ?? "");
    if (url.protocol === "https:" && !url.username && !url.password)
      logo = url.href;
  } catch {
    /* Channels without a valid logo use their name, not invented artwork. */
  }
  if (logo && !failed) {
    return (
      <span className="flex h-full w-full items-center justify-center">
        {/* Provider logos are remote and must not pass through the image optimizer. */}
        {/* biome-ignore lint/performance/noImgElement: provider logos are remote and bypass the Next.js image optimizer. */}
        <img
          alt=""
          className="h-9 w-16 shrink-0 rounded-md object-contain"
          height={36}
          width={64}
          loading="lazy"
          onError={() => setFailed(true)}
          referrerPolicy="no-referrer"
          src={logo}
        />
      </span>
    );
  }
  return (
    <span className="line-clamp-2 min-w-0 flex-1 wrap-break-word text-sm leading-tight font-medium">
      {channel.name}
    </span>
  );
}

function ProgrammeDetails({
  channel,
  programme,
  timeFormatter,
  dateFormatter,
  onChannelSelect,
}: {
  channel: LiveTvChannel;
  programme: LiveTvProgramme;
  timeFormatter: Intl.DateTimeFormat;
  dateFormatter: Intl.DateTimeFormat;
  onChannelSelect: LiveTvGuideProps["onChannelSelect"];
}) {
  const { t: rawT } = useTranslation();
  const t = (key: string) => rawT(key as never) as unknown as string;
  return (
    <DialogContent showCloseButton={false}>
      <DialogHeader>
        <DialogTitle className="wrap-break-word leading-snug">
          {programme.title}
        </DialogTitle>
        <DialogDescription>
          {channel.name} · {dateFormatter.format(Date.parse(programme.start))}{" "}
          {timeFormatter.format(Date.parse(programme.start))} –{" "}
          {dateFormatter.format(Date.parse(programme.end))}{" "}
          {timeFormatter.format(Date.parse(programme.end))}
        </DialogDescription>
      </DialogHeader>
      <ScrollArea className="max-h-56 min-h-0 **:data-[slot=scroll-area-viewport]:max-h-56">
        <p className="whitespace-pre-line wrap-break-word pr-3 text-sm text-muted-foreground">
          {programme.description || t("Sin descripción disponible.")}
        </p>
      </ScrollArea>
      <p className="text-sm text-muted-foreground">
        {t(
          "Live TV reproduce el canal en directo. Los programas futuros no son grabaciones y no se pueden adelantar ni recuperar desde la guía.",
        )}
      </p>
      <DialogFooter>
        <DialogClose render={<Button data-dpad-focusable variant="outline" />}>
          {t("Cerrar")}
        </DialogClose>
        <DialogClose
          render={
            <Button
              data-dpad-focusable
              onClick={() => onChannelSelect(channel)}
            />
          }
        >
          {t("Ver canal en vivo")}
        </DialogClose>
      </DialogFooter>
    </DialogContent>
  );
}

export function LiveTvGuide({
  source,
  channels,
  group,
  groups,
  onGroupChange,
  selectedChannelId,
  onChannelSelect,
}: LiveTvGuideProps) {
  const { t: rawT } = useTranslation();
  const t = (key: string, options?: Record<string, unknown>) =>
    rawT(key as never, options as never) as unknown as string;
  const titleId = useId();
  const categoryId = useId();
  const [page, setPage] = useState(0);
  const [windowStart, setWindowStart] = useState<number | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<GuideState | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const scope = useRef<GlimmScopeHandle>(null);
  const scopeBox = useRef<HTMLDivElement>(null);
  const visible = useMemo(() => getGuidePage(channels, page), [channels, page]);
  const { activeProfileId } = useOneVidProfiles();
  const [savedStatuses, setSavedStatuses] = useState<
    Record<string, { favorite: boolean; watchlist: boolean }>
  >({});
  const visibleSavedIds = useMemo(
    () =>
      visible.channels.map((channel) =>
        buildLiveSavedId(source.id, channel.id)
      ),
    [visible.channels, source.id]
  );
  const visibleSavedKey = visibleSavedIds.join("|");
  const [formatters, setFormatters] = useState<{
    time: Intl.DateTimeFormat;
    date: Intl.DateTimeFormat;
  } | null>(null);

  useEffect(() => {
    if (!activeProfileId || visibleSavedIds.length === 0) return;
    const controller = new AbortController();
    fetch("/api/onevid-saved-statuses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Profile-Id": activeProfileId,
      },
      body: JSON.stringify({ mediaType: "live", ids: visibleSavedIds }),
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then(
        (
          data: {
            statuses?: Record<
              string,
              { favorite: boolean; watchlist: boolean }
            >;
          } | null
        ) => {
          if (data?.statuses) {
            setSavedStatuses((previous) => ({
              ...previous,
              ...data.statuses,
            }));
          }
        }
      )
      .catch(() => {
        // Sin perfil o sin red: los botones quedan apagados, no rompen la guía.
      });
    return () => controller.abort();
  }, [activeProfileId, visibleSavedIds, visibleSavedKey]);

  const toggleSaved = useCallback(
    async (channel: LiveTvChannel, kind: "favorite" | "watchlist") => {
      if (!activeProfileId) return;
      const mediaId = buildLiveSavedId(source.id, channel.id);
      const current = savedStatuses[mediaId] ?? {
        favorite: false,
        watchlist: false,
      };
      const next = !current[kind];
      setSavedStatuses((previous) => ({
        ...previous,
        [mediaId]: { ...current, [kind]: next },
      }));
      try {
        const response = await fetch(
          kind === "favorite" ? "/api/onevid-favorite" : "/api/onevid-watchlist",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Profile-Id": activeProfileId,
            },
            body: JSON.stringify({
              mediaId,
              mediaType: "live",
              value: next,
              name: channel.name,
              poster: channel.logo,
              background: channel.logo,
            }),
          }
        );
        if (!response.ok) throw new Error("save failed");
      } catch {
        setSavedStatuses((previous) => ({
          ...previous,
          [mediaId]: current,
        }));
      }
    },
    [activeProfileId, savedStatuses, source.id]
  );

  useEffect(() => {
    // The server's timezone/clock may differ from the viewer's. Initialize local
    // dates after hydration, then keep the now marker moving without refetching.
    const instant = Date.now();
    setNow(instant);
    setWindowStart(getGuideWindowStart(instant));
    setFormatters({
      time: new Intl.DateTimeFormat(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      }),
      date: new Intl.DateTimeFormat(undefined, {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
      }),
    });
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const windowEnd = windowStart === null ? null : windowStart + GUIDE_WINDOW_MS;
  const payload =
    windowStart === null || windowEnd === null
      ? null
      : JSON.stringify({
          sourceId: source.id,
          channelIds: visible.channels.map((channel) => channel.id),
          start: new Date(windowStart).toISOString(),
          end: new Date(windowEnd).toISOString(),
        });
  const requestKey = JSON.stringify([payload, attempt]);
  const canLoad =
    source.hasEpg && visible.channels.length > 0 && payload !== null;

  useEffect(() => {
    if (!canLoad || payload === null) return;
    const body = payload;
    const controller = new AbortController();
    let active = true;
    const timeout = window.setTimeout(() => {
      controller.abort();
      if (active) setState({ key: requestKey, status: "error", timeout: true });
    }, GUIDE_TIMEOUT_MS);

    async function load() {
      try {
        const rows = await fetchGuideRows(body, controller.signal);
        if (active && !controller.signal.aborted) {
          setState({ key: requestKey, status: "ready", rows });
        }
      } catch {
        // Never expose provider errors, URLs or source credentials in the UI.
        if (active && !controller.signal.aborted)
          setState({ key: requestKey, status: "error", timeout: false });
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
  }, [canLoad, payload, requestKey]);

  // A response from the previous page/window must never flash under new rows.
  const currentState = canLoad && state?.key === requestKey ? state : null;
  const loading =
    source.hasEpg && visible.channels.length > 0 && currentState === null;
  const ticks =
    windowStart === null
      ? []
      : Array.from(
          { length: 6 },
          (_, index) => windowStart + index * GUIDE_TICK_MS,
        );
  const nowPosition =
    now !== null &&
    windowStart !== null &&
    windowEnd !== null &&
    now >= windowStart &&
    now < windowEnd
      ? ((now - windowStart) / GUIDE_WINDOW_MS) * 100
      : null;
  const retry = () => setAttempt((value) => value + 1);

  // El barrido revela la guía nueva: la petición y el cambio de estado viven
  // dentro del scope para que las filas nuevas aparezcan detrás de la banda.
  const refreshGuide = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (!canLoad || payload === null) return;
    const animator = scope.current;
    if (!animator) {
      retry();
      return;
    }
    const key = requestKey;
    const body = payload;
    const button = event.currentTarget.getBoundingClientRect();
    const box = scopeBox.current?.getBoundingClientRect();
    setRefreshing(true);
    animator.play({
      at: box
        ? [
            Math.min(
              Math.max(button.left + button.width / 2 - box.left, 0),
              box.width,
            ),
            Math.min(
              Math.max(button.top + button.height / 2 - box.top, 0),
              box.height,
            ),
          ]
        : undefined,
      work: async () => {
        const controller = new AbortController();
        const timer = window.setTimeout(
          () => controller.abort(),
          GUIDE_TIMEOUT_MS,
        );
        try {
          return await fetchGuideRows(body, controller.signal);
        } finally {
          window.clearTimeout(timer);
        }
      },
      change: (rows) => setState({ key, status: "ready", rows }),
      onBurst: () => setRefreshing(false),
      onFail: (error) => {
        setRefreshing(false);
        setState({
          key,
          status: "error",
          timeout: error instanceof DOMException && error.name === "AbortError",
        });
      },
    });
  };
  const busy = loading || refreshing;

  return (
    <section
      aria-labelledby={titleId}
      className="min-w-0 max-w-full overflow-hidden rounded-xl border border-border bg-card text-card-foreground"
    >
      <div className="flex flex-col gap-2 border-b border-border p-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3 sm:p-3">
        <h2
          className="flex shrink-0 items-center gap-2 text-sm font-semibold"
          id={titleId}
        >
          <CalendarDaysIcon
            aria-hidden="true"
            className="size-4 text-muted-foreground"
          />
          {t("Guía de Live TV")}
        </h2>
        <div className="flex min-w-0 items-center gap-2">
          {groups.length > 0 ? (
            <Select
              items={[
                { value: "all", label: t("Todas las categorías") },
                ...groups.map((name) => ({ value: name, label: name })),
              ]}
              onValueChange={(value) =>
                onGroupChange(!value || value === "all" ? "" : value)
              }
              value={group || "all"}
            >
              <SelectTrigger
                aria-label={t("Categoría")}
                className="h-8 min-w-0 flex-1 justify-between rounded-lg px-2.5 text-xs [&>span]:truncate sm:flex-none"
                data-dpad-focusable
                id={categoryId}
                size="sm"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent
                align="end"
                className="max-w-[min(24rem,calc(100vw-2rem))] min-w-(--anchor-width) w-auto"
              >
                <SelectItem value="all">{t("Todas las categorías")}</SelectItem>
                {groups.map((name) => (
                  <SelectItem
                    className="[&>div]:min-w-0 [&>div]:truncate"
                    key={name}
                    value={name}
                  >
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          {/* biome-ignore lint/a11y/useSemanticElements: toolbar group; a fieldset would add unwanted form semantics. */}
          <div
            aria-label={t("Ventana de programación")}
            className="flex shrink-0 items-center gap-1"
            role="group"
          >
          <Button
            aria-label={t("Tres horas anteriores")}
            data-dpad-focusable
            disabled={windowStart === null}
            onClick={() =>
              setWindowStart((value) =>
                value === null ? value : value - GUIDE_WINDOW_MS,
              )
            }
            size="icon-sm"
            variant="ghost"
          >
            <ChevronLeftIcon aria-hidden="true" />
          </Button>
          <Button
            data-dpad-focusable
            disabled={windowStart === null}
            onClick={() => {
              const instant = Date.now();
              setNow(instant);
              setWindowStart(getGuideWindowStart(instant));
            }}
            size="sm"
            variant="secondary"
          >
            {t("Ahora")}
          </Button>
          <Button
            aria-label={t("Tres horas siguientes")}
            data-dpad-focusable
            disabled={windowStart === null}
            onClick={() =>
              setWindowStart((value) =>
                value === null ? value : value + GUIDE_WINDOW_MS,
              )
            }
            size="icon-sm"
            variant="ghost"
          >
            <ChevronRightIcon aria-hidden="true" />
          </Button>
          <Button
            aria-label={t("Actualizar guía")}
            data-dpad-focusable
            disabled={!canLoad || busy}
            onClick={refreshGuide}
            size="icon-sm"
            variant="ghost"
          >
            <RefreshCcwDotIcon
              aria-hidden="true"
              className={busy ? "hidden" : ""}
            />
            {busy ? (
              <Loader
                aria-label={t("Cargando guía")}
                className="size-4 animate-spin"
              />
            ) : null}
          </Button>
          </div>
        </div>
      </div>

      {!source.hasEpg ? (
        <Alert
          className="rounded-none border-0 border-b border-border"
          role="status"
        >
          <AlertTitle>
            {t("Esta fuente no tiene una guía de programación configurada.")}
          </AlertTitle>
          <AlertDescription>
            {t(
              "Configura una guía en los ajustes de Live TV para ver horarios. Puedes ver los canales en vivo sin ella.",
            )}
          </AlertDescription>
        </Alert>
      ) : currentState?.status === "error" ? (
        <Alert
          className="rounded-none border-0 border-b border-border"
          variant="destructive"
        >
          <AlertTitle>
            {currentState.timeout
              ? t("La guía tardó demasiado en responder.")
              : t("No se pudo cargar la guía de Live TV.")}
          </AlertTitle>
          <AlertDescription>
            {t("La reproducción en vivo no se ve afectada.")}{" "}
            <Button
              data-dpad-focusable
              onClick={retry}
              size="sm"
              variant="outline"
            >
              {t("Reintentar guía")}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {channels.length === 0 ? (
        <p className="p-6 text-sm text-muted-foreground" role="status">
          {t("No hay canales para estos filtros.")}
        </p>
      ) : (
        <>
          <p className="sr-only" role="status">
            {loading
              ? t("Cargando guía de programación…")
              : t("Página {{page}} de {{pageCount}}", {
                  page: visible.page + 1,
                  pageCount: visible.pageCount,
                })}
          </p>
          <div className="h-[min(65vh,36rem)] w-full min-w-0" ref={scopeBox}>
            <GlimmScope
              brightness={0.95}
              curve={0.32}
              direction="ttb"
              palette="azure"
              ref={scope}
              style={{ height: "100%" }}
              sweepMs={2200}
            >
              <ScrollArea
                aria-label={t(
                  "Canales y horarios de Live TV. Usa las flechas para desplazarte.",
                )}
                className="h-full w-full min-w-0 overflow-hidden bg-card [--channel-width:170px] sm:[--channel-width:210px] **:data-[slot=scroll-area-viewport]:scroll-pt-12 **:data-[slot=scroll-area-viewport]:scroll-pl-(--channel-width)"
                data-dpad-focusable
                role="region"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  const offsets: Record<string, [number, number]> = {
                    ArrowLeft: [-160, 0],
                    ArrowRight: [160, 0],
                    ArrowUp: [0, -80],
                    ArrowDown: [0, 80],
                  };
                  const offset = offsets[event.key];
                  if (offset) {
                    event.preventDefault();
                    event.currentTarget
                      .querySelector('[data-slot="scroll-area-viewport"]')
                      ?.scrollBy({ left: offset[0], top: offset[1] });
                  }
                }}
              >
                <div className="relative w-[calc(var(--channel-width)+960px)] min-w-full pb-3">
                  <div className="sticky top-0 z-30 flex h-12 border-b border-border bg-muted">
                    <div className="sticky left-0 z-40 flex w-(--channel-width) shrink-0 items-center gap-1 overflow-hidden border-r border-border bg-muted px-2 text-xs font-semibold">
                      <span>{t("Canal")}</span>
                      {channels.length > 0 ? (
                        <Badge
                          className="ml-auto h-4 shrink-0 px-1 text-[9px]"
                          variant="outline"
                        >
                          {t("{{n}} canales", { n: channels.length })}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="relative min-w-0 flex-1">
                      {ticks.map((tick, index) => (
                        <div
                          className="absolute inset-y-0 border-l border-border px-2 py-1 text-xs tabular-nums"
                          key={tick}
                          style={{
                            left: `${(index / 6) * 100}%`,
                            width: `${100 / 6}%`,
                          }}
                        >
                          <time dateTime={new Date(tick).toISOString()}>
                            {formatters?.time.format(tick)}
                          </time>
                          <span className="block truncate text-[10px] text-muted-foreground">
                            {formatters?.date.format(tick)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                  {visible.channels.map((channel) => {
                    const row =
                      currentState?.status === "ready"
                        ? currentState.rows.get(channel.id)
                        : undefined;
                    const rowError =
                      currentState?.status === "ready" && (!row || row.error);
                    const layout =
                      row &&
                      !row.error &&
                      windowStart !== null &&
                      windowEnd !== null
                        ? getProgrammeLayout(row.programmes, windowStart, windowEnd)
                        : [];
                    const height = Math.max(
                      84,
                      (Math.max(0, ...layout.map((item) => item.lane)) + 1) * 64 +
                        8,
                    );
                    const selected = selectedChannelId === channel.id;
                    const mediaId = buildLiveSavedId(source.id, channel.id);
                    const status = savedStatuses[mediaId] ?? {
                      favorite: false,
                      watchlist: false,
                    };
                    return (
                      <div
                        className="flex border-b border-border"
                        data-channel-id={channel.id}
                        key={channel.id}
                        style={{ height }}
                      >
                        <div className="sticky left-0 z-20 flex w-(--channel-width) shrink-0 items-center border-r border-border bg-card">
                          <Button
                            aria-label={t("Ver {{name}} en vivo", {
                              name: channel.name,
                            })}
                            aria-pressed={selected}
                            data-dpad-focusable
                            className={`h-full min-w-0 flex-1 justify-start gap-2 rounded-none px-2 text-left whitespace-normal ${selected ? "border-l-2 border-l-primary bg-primary/10 text-primary" : "text-card-foreground"}`}
                            onClick={() => onChannelSelect(channel)}
                            variant="ghost"
                          >
                            <ChannelIdentity
                              channel={channel}
                              key={`${channel.logo ?? ""}:${channel.name}`}
                            />
                          </Button>
                          <div className="flex w-8 shrink-0 flex-col items-center justify-center gap-0.5">
                            <Button
                              aria-label={t("Favoritos")}
                              aria-pressed={status.favorite}
                              className="size-7"
                              data-dpad-focusable
                              onClick={() => void toggleSaved(channel, "favorite")}
                              size="icon-xs"
                              variant="ghost"
                            >
                              <HeartIcon
                                className={
                                  status.favorite
                                    ? "size-3.5 fill-current text-primary"
                                    : "size-3.5 text-muted-foreground"
                                }
                              />
                            </Button>
                            <Button
                              aria-label={t("Ver después")}
                              aria-pressed={status.watchlist}
                              className="size-7"
                              data-dpad-focusable
                              onClick={() => void toggleSaved(channel, "watchlist")}
                              size="icon-xs"
                              variant="ghost"
                            >
                              <BookmarkIcon
                                className={
                                  status.watchlist
                                    ? "size-3.5 fill-current text-primary"
                                    : "size-3.5 text-muted-foreground"
                                }
                              />
                            </Button>
                          </div>
                        </div>
                        <div className="relative min-w-0 flex-1 bg-muted/20">
                          <div
                            aria-hidden="true"
                            className="pointer-events-none absolute inset-0 flex"
                          >
                            {Array.from({ length: 6 }, (_, index) => (
                              <div
                                className="h-full flex-1 border-l border-border/60"
                                key={index}
                              />
                            ))}
                          </div>
                          {loading ? (
                            <div
                              aria-hidden="true"
                              className="flex h-full w-[calc(100%/6)] flex-col justify-center gap-2 p-2"
                            >
                              <Skeleton className="h-3 w-full" />
                              <Skeleton className="h-3 w-3/4" />
                            </div>
                          ) : rowError ? (
                            <div
                              className="relative flex h-full w-[calc(100%/6)] flex-col items-center justify-center gap-1 px-2 py-2 text-center text-xs text-muted-foreground"
                              role="status"
                            >
                              <span className="line-clamp-2">
                                {t("No se pudo cargar este canal.")}
                              </span>
                              <Button
                                aria-label={t("Reintentar guía de {{name}}", {
                                  name: channel.name,
                                })}
                                data-dpad-focusable
                                onClick={retry}
                                size="xs"
                                variant="outline"
                              >
                                {t("Reintentar")}
                              </Button>
                            </div>
                          ) : layout.length === 0 ? (
                            <p className="relative flex h-full w-[calc(100%/6)] items-center justify-center whitespace-nowrap px-2 text-center text-xs text-muted-foreground">
                              {!source.hasEpg
                                ? t("Sin guía configurada")
                                : currentState?.status === "error"
                                  ? t("Guía no disponible")
                                  : t("Sin programación")}
                            </p>
                          ) : (
                            layout.map(
                              (
                                { programme, start, end, x, width, lane },
                                index,
                              ) => {
                                const live =
                                  now !== null && start <= now && now < end;
                                return (
                                  <Dialog key={`${programme.id}:${start}:${index}`}>
                                    <DialogTrigger
                                      render={
                                        <Button
                                          aria-label={`${programme.title}, ${channel.name}, ${formatters?.date.format(start)} ${formatters?.time.format(start)} – ${formatters?.date.format(end)} ${formatters?.time.format(end)}`}
                                          className={`absolute h-15 min-w-0 flex-col items-start justify-center gap-1 overflow-hidden rounded-md border px-2 text-left whitespace-normal focus-visible:z-10 ${live ? "border-primary/50 bg-primary/15 text-foreground hover:bg-primary/25" : "border-border bg-card text-card-foreground hover:bg-muted"}`}
                                          data-dpad-focusable
                                          style={{
                                            left: `${x}%`,
                                            width: `max(0px, calc(${width}% - 2px))`,
                                            top: 4 + lane * 64,
                                          }}
                                          variant="ghost"
                                        />
                                      }
                                    >
                                      <span className="flex w-full min-w-0 items-center gap-1">
                                        <span className="truncate text-xs font-semibold">
                                          {programme.title}
                                        </span>
                                        {live ? (
                                          <Badge className="h-4 px-1 text-[9px]">
                                            {t("En vivo")}
                                          </Badge>
                                        ) : null}
                                      </span>
                                      <span className="w-full truncate text-[10px] tabular-nums text-muted-foreground">
                                        {formatters?.time.format(start)} –{" "}
                                        {formatters?.time.format(end)}
                                      </span>
                                    </DialogTrigger>
                                    {formatters ? (
                                      <ProgrammeDetails
                                        channel={channel}
                                        programme={programme}
                                        timeFormatter={formatters.time}
                                        dateFormatter={formatters.date}
                                        onChannelSelect={onChannelSelect}
                                      />
                                    ) : null}
                                  </Dialog>
                                );
                              },
                            )
                          )}
                          {nowPosition !== null ? (
                            <div
                              aria-hidden="true"
                              className="pointer-events-none absolute inset-y-0 z-10 w-px bg-primary"
                              style={{ left: `${nowPosition}%` }}
                            />
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <ScrollBar orientation="horizontal" />
              </ScrollArea>
            </GlimmScope>
          </div>
          <nav
            aria-label={t("Páginas de canales")}
            className="flex items-center justify-between gap-2 border-t border-border p-3"
          >
            <Button
              aria-label={t("Página anterior de canales")}
              data-dpad-focusable
              disabled={visible.page === 0}
              onClick={() => setPage(visible.page - 1)}
              size="sm"
              variant="outline"
            >
              <ChevronLeftIcon aria-hidden="true" />
              {t("Anterior")}
            </Button>
            <span className="text-center text-xs tabular-nums text-muted-foreground">
              {visible.page + 1} / {visible.pageCount}
              <span className="block">
                {t("{{n}} canales", { n: channels.length })}
              </span>
            </span>
            <Button
              aria-label={t("Página siguiente de canales")}
              data-dpad-focusable
              disabled={visible.page + 1 >= visible.pageCount}
              onClick={() => setPage(visible.page + 1)}
              size="sm"
              variant="outline"
            >
              {t("Siguiente")}
              <ChevronRightIcon aria-hidden="true" />
            </Button>
          </nav>
        </>
      )}
    </section>
  );
}
