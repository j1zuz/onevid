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
import {
  CalendarDaysIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  Loader,
  RefreshCcwDotIcon,
} from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import type {
  LiveTvChannel,
  LiveTvGuideResponse,
  LiveTvGuideRow,
  LiveTvProgramme,
  LiveTvSourceSummary,
} from "@/lib/live-tv";
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

export interface LiveTvGuideProps {
  source: LiveTvSourceSummary;
  channels: LiveTvChannel[];
  group: string;
  groups: string[];
  onGroupChange: (group: string) => void;
  selectedChannelId?: string;
  onChannelSelect: (channel: LiveTvChannel) => void;
}

function ChannelLogo({ channel }: { channel: LiveTvChannel }) {
  const [failed, setFailed] = useState(false);
  let logo: string | undefined;
  try {
    const url = new URL(channel.logo ?? "");
    if (url.protocol === "https:" && !url.username && !url.password)
      logo = url.href;
  } catch {
    /* Channels without a valid logo use their name, not invented artwork. */
  }
  return logo && !failed ? (
    // Provider logos are remote and must not pass through the image optimizer.
    // biome-ignore lint/performance/noImgElement: provider logos are remote and bypass the Next.js image optimizer.
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
  ) : null;
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
          {programme.description || "Sin descripción disponible."}
        </p>
      </ScrollArea>
      <p className="text-sm text-muted-foreground">
        Live TV reproduce el canal en directo, no este programa a la carta. Los
        programas futuros no son grabaciones y no se pueden adelantar ni
        recuperar desde la guía.
      </p>
      <DialogFooter>
        <DialogClose render={<Button data-dpad-focusable variant="outline" />}>
          Cerrar
        </DialogClose>
        <DialogClose
          render={
            <Button
              data-dpad-focusable
              onClick={() => onChannelSelect(channel)}
            />
          }
        >
          Ver canal en vivo
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
  const titleId = useId();
  const categoryId = useId();
  const [page, setPage] = useState(0);
  const [windowStart, setWindowStart] = useState<number | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<GuideState | null>(null);
  const visible = useMemo(() => getGuidePage(channels, page), [channels, page]);
  const [formatters, setFormatters] = useState<{
    time: Intl.DateTimeFormat;
    date: Intl.DateTimeFormat;
  } | null>(null);

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
    const controller = new AbortController();
    let active = true;
    const timeout = window.setTimeout(() => {
      controller.abort();
      if (active) setState({ key: requestKey, status: "error", timeout: true });
    }, 90_000);

    async function load() {
      try {
        const response = await fetch("/api/onevid-live-tv/guide", {
          method: "POST",
          body: payload,
          signal: controller.signal,
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
        if (active && !controller.signal.aborted) {
          setState({
            key: requestKey,
            status: "ready",
            rows: new Map(data.channels.map((row) => [row.channelId, row])),
          });
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

  return (
    <section
      aria-labelledby={titleId}
      className="min-w-0 max-w-full overflow-hidden rounded-xl border border-border bg-card text-card-foreground"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-3">
        <h2
          className="flex items-center gap-2 text-sm font-semibold"
          id={titleId}
        >
          <CalendarDaysIcon
            aria-hidden="true"
            className="size-4 text-muted-foreground"
          />
          Guía de Live TV
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {groups.length > 0 ? (
            <Select
              items={[
                { value: "all", label: "Todas las categorías" },
                ...groups.map((name) => ({ value: name, label: name })),
              ]}
              onValueChange={(value) =>
                onGroupChange(!value || value === "all" ? "" : value)
              }
              value={group || "all"}
            >
              <SelectTrigger
                aria-label="Categoría"
                className="h-8 w-auto min-w-0 rounded-lg px-2.5 text-xs"
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
                <SelectItem value="all">Todas las categorías</SelectItem>
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
            aria-label="Ventana de programación"
            className="flex flex-wrap items-center gap-1"
            role="group"
          >
          <Button
            aria-label="Tres horas anteriores"
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
            Ahora
          </Button>
          <Button
            aria-label="Tres horas siguientes"
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
            aria-label="Actualizar guía"
            data-dpad-focusable
            disabled={!canLoad || loading}
            onClick={retry}
            size="icon-sm"
            variant="ghost"
          >
            <RefreshCcwDotIcon
              aria-hidden="true"
              className={loading ? "hidden" : ""}
            />
            {loading ? (
              <Loader aria-label="Cargando guía" className="size-4 animate-spin" />
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
            Esta fuente no tiene una guía de programación configurada.
          </AlertTitle>
          <AlertDescription>
            Configura una guía en los ajustes de Live TV para ver horarios.
            Puedes ver los canales en vivo sin ella.
          </AlertDescription>
        </Alert>
      ) : currentState?.status === "error" ? (
        <Alert
          className="rounded-none border-0 border-b border-border"
          variant="destructive"
        >
          <AlertTitle>
            {currentState.timeout
              ? "La guía tardó demasiado en responder."
              : "No se pudo cargar la guía de Live TV."}
          </AlertTitle>
          <AlertDescription>
            La reproducción en vivo no se ve afectada.{" "}
            <Button
              data-dpad-focusable
              onClick={retry}
              size="sm"
              variant="outline"
            >
              Reintentar guía
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {channels.length === 0 ? (
        <p className="p-6 text-sm text-muted-foreground" role="status">
          No hay canales para estos filtros.
        </p>
      ) : (
        <>
          <p className="sr-only" role="status">
            {loading
              ? "Cargando guía de programación…"
              : `Página ${visible.page + 1} de ${visible.pageCount}`}
          </p>
          <ScrollArea
            aria-label="Canales y horarios de Live TV. Usa las flechas para desplazarte."
            className="h-[min(65vh,36rem)] w-full min-w-0 overflow-hidden [--channel-width:132px] sm:[--channel-width:164px] **:data-[slot=scroll-area-viewport]:scroll-pt-12 **:data-[slot=scroll-area-viewport]:scroll-pl-(--channel-width)"
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
                  <span>Canal</span>
                  {channels.length > 0 ? (
                    <Badge
                      className="ml-auto h-4 shrink-0 px-1 text-[9px]"
                      variant="outline"
                    >
                      {channels.length} canales
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
                  76,
                  (Math.max(0, ...layout.map((item) => item.lane)) + 1) * 64 +
                    8,
                );
                const selected = selectedChannelId === channel.id;
                return (
                  <div
                    className="flex border-b border-border"
                    data-channel-id={channel.id}
                    key={channel.id}
                    style={{ height }}
                  >
                    <div className="sticky left-0 z-20 w-(--channel-width) shrink-0 border-r border-border bg-card">
                      <Button
                        aria-label={`Ver ${channel.name} en vivo`}
                        aria-pressed={selected}
                        data-dpad-focusable
                        className={`h-full w-full justify-start gap-2 rounded-none px-2 text-left whitespace-normal ${selected ? "border-l-2 border-l-primary bg-primary/10 text-primary" : "text-card-foreground"}`}
                        onClick={() => onChannelSelect(channel)}
                        variant="ghost"
                      >
                        <ChannelLogo key={channel.logo} channel={channel} />
                        <span className="line-clamp-3 min-w-0 wrap-break-word text-xs font-medium">
                          {channel.name}
                        </span>
                      </Button>
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
                            No se pudo cargar este canal.
                          </span>
                          <Button
                            aria-label={`Reintentar guía de ${channel.name}`}
                            data-dpad-focusable
                            onClick={retry}
                            size="xs"
                            variant="outline"
                          >
                            Reintentar
                          </Button>
                        </div>
                      ) : layout.length === 0 ? (
                        <p className="relative flex h-full w-[calc(100%/6)] items-center justify-center whitespace-nowrap px-2 text-center text-xs text-muted-foreground">
                          {!source.hasEpg
                            ? "Sin guía configurada"
                            : currentState?.status === "error"
                              ? "Guía no disponible"
                              : "Sin programación"}
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
                                        En vivo
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
          <nav
            aria-label="Páginas de canales"
            className="flex items-center justify-between gap-2 border-t border-border p-3"
          >
            <Button
              aria-label="Página anterior de canales"
              data-dpad-focusable
              disabled={visible.page === 0}
              onClick={() => setPage(visible.page - 1)}
              size="sm"
              variant="outline"
            >
              <ChevronLeftIcon aria-hidden="true" />
              Anterior
            </Button>
            <span className="text-center text-xs tabular-nums text-muted-foreground">
              {visible.page + 1} / {visible.pageCount}
              <span className="block">{channels.length} canales</span>
            </span>
            <Button
              aria-label="Página siguiente de canales"
              data-dpad-focusable
              disabled={visible.page + 1 >= visible.pageCount}
              onClick={() => setPage(visible.page + 1)}
              size="sm"
              variant="outline"
            >
              Siguiente
              <ChevronRightIcon aria-hidden="true" />
            </Button>
          </nav>
        </>
      )}
    </section>
  );
}
