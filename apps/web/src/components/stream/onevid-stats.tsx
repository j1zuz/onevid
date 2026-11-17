"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { toPng } from "html-to-image";
import { toast } from "sonner";
import {
  EChartsAreaChart,
  type ChartConfig as AreaChartConfig,
} from "@/components/evilcharts/charts/echarts-area-chart";
import {
  EChartsBarChart,
  type ChartConfig as BarChartConfig,
} from "@/components/evilcharts/charts/echarts-bar-chart";
import {
  EChartsHeatmapChart,
  type ChartConfig,
  type HeatmapSelection,
} from "@/components/evilcharts/charts/echarts-heatmap-chart";
import { useOneVidProfiles } from "@/components/stream/onevid-profile-context";
import { tmdbImage } from "@/lib/tmdb";
import { useTranslation } from "@/lib/onevid-i18n-context";
import { cn } from "@workspace/ui/lib/utils";

interface StatsResponse {
  days: { day: string; seconds: number }[];
  totals: { seconds: number; activeDays: number };
  streak: { current: number; longest: number };
  byType: { movie: number; series: number };
  months: { month: number; current: number; previous: number }[];
  titlesLocked?: boolean;
  top: {
    mediaId: string;
    name: string;
    mediaType: string;
    positionSec: number;
    episodes: number;
    poster: string | null;
    background: string | null;
  }[];
}

type Range = "7d" | "15d" | "month" | "year";

// Relaciones de aspecto ofrecidas al descargar la tarjeta (como un editor de
// recorte). "free" guarda la captura tal cual.
const RATIOS = [
  { id: "free", label: "Libre" },
  { height: 1080, id: "1:1", label: "1:1", width: 1080 },
  { height: 1350, id: "4:5", label: "4:5", width: 1080 },
  { height: 1920, id: "9:16", label: "9:16", width: 1080 },
  { height: 1080, id: "16:9", label: "16:9", width: 1920 },
  { height: 1080, id: "4:3", label: "4:3", width: 1440 },
] as const;

function minutes(sec: number): number {
  return Math.round(sec / 60);
}

/** Últimos `count` días (UTC, como la BD) con sus minutos. */
function lastDays(
  days: { day: string; seconds: number }[],
  count: number
): { label: string; value: number }[] {
  const byDay = new Map(days.map((row) => [row.day, minutes(row.seconds)]));
  const result: { label: string; value: number }[] = [];
  for (let index = count - 1; index >= 0; index -= 1) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - index);
    const key = date.toISOString().slice(0, 10);
    result.push({
      label: date.toLocaleDateString(undefined, {
        day: "2-digit",
        month: "short",
      }),
      value: byDay.get(key) ?? 0,
    });
  }
  return result;
}

/** Carga una imagen (con CORS opcional) o falla en silencio. */
function loadImage(
  src: string,
  crossOrigin = false
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    if (crossOrigin) {
      image.crossOrigin = "anonymous";
    }
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image"));
    image.src = src;
  });
}

/** Rectángulo redondeado (compatible con navegadores sin ctx.roundRect). */
function roundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

/**
 * Compone la imagen descargable para un formato concreto.
 *
 * La foto del título va a sangre ocupando todo el lienzo y se funde con un
 * degradado hacia el fondo; las estadísticas se dibujan encima, sin tarjeta ni
 * marcos. Así la imagen forma parte del fondo en vez de parecer pegada encima.
 */
async function composeFramed(
  contentDataUrl: string,
  width: number,
  height: number,
  backdrop: string | null
): Promise<string> {
  const content = await loadImage(contentDataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("canvas");
  }

  context.fillStyle = "#06080c";
  context.fillRect(0, 0, width, height);

  const background = backdrop
    ? await loadImage(backdrop, true).catch(() => null)
    : null;
  if (background) {
    const cover = Math.max(
      width / background.width,
      height / background.height
    );
    const coverWidth = background.width * cover;
    const coverHeight = background.height * cover;
    context.drawImage(
      background,
      (width - coverWidth) / 2,
      (height - coverHeight) / 2,
      coverWidth,
      coverHeight
    );

    // La foto se funde con el fondo: nítida arriba y oscura donde va el texto.
    const shade = context.createLinearGradient(0, 0, 0, height);
    shade.addColorStop(0, "rgba(6,8,12,0.12)");
    shade.addColorStop(0.32, "rgba(6,8,12,0.35)");
    shade.addColorStop(0.5, "rgba(6,8,12,0.92)");
    shade.addColorStop(1, "#06080c");
    context.fillStyle = shade;
    context.fillRect(0, 0, width, height);
  }

  // Contenido (textos, gráfica, listas) escalado y centrado en la mitad baja.
  const zoneTop = height * 0.42;
  const zoneHeight = height * 0.52;
  const scale = Math.min(
    (width * 0.88) / content.width,
    zoneHeight / content.height
  );
  const contentWidth = Math.round(content.width * scale);
  const contentHeight = Math.round(content.height * scale);
  const x = Math.round((width - contentWidth) / 2);
  const y = Math.round(zoneTop + (zoneHeight - contentHeight) / 2);
  context.drawImage(content, x, y, contentWidth, contentHeight);

  return canvas.toDataURL("image/png");
}

function hours(sec: number): string {
  const value = sec / 3600;
  return value >= 10 ? String(Math.round(value)) : value.toFixed(1);
}

/**
 * Tarjeta de estadísticas de Configuración → Cuenta: heatmap de calendario
 * (día) o barras por mes, con totales, rachas y los títulos más vistos.
 *
 * Datos: `/api/onevid-stats` — días desde `onevid_profile_activity` (se llena
 * al ver contenido; no hay histórico hacia atrás) y títulos desde
 * `onevid_profile_progress`.
 */
export function OneVidStats() {
  const { t } = useTranslation();
  const { activeProfileId, profiles } = useOneVidProfiles();
  const activeProfile = profiles.find((item) => item.id === activeProfileId);
  const [data, setData] = useState<StatsResponse | null>(null);
  const [failure, setFailure] = useState<"network" | null>(null);

  const [range, setRange] = useState<Range>("year");
  const [selectedDay, setSelectedDay] = useState<HeatmapSelection | null>(null);
  // Tarjeta lista para compartir como imagen (ads del perfil).
  const cardRef = useRef<HTMLElement | null>(null);
  const heroRef = useRef<HTMLDivElement | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [ratio, setRatio] = useState<(typeof RATIOS)[number]["id"]>("free");

  useEffect(() => {
    if (!activeProfileId) {
      return;
    }
    const controller = new AbortController();
    setFailure(null);
    fetch("/api/onevid-stats", {
      headers: { "X-Profile-Id": activeProfileId },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.ok) {
          return (await response.json()) as StatsResponse;
        }
        setFailure("network");
        return null;
      })
      .then((result) => {
        if (result) {
          setData(result);
        }
      })
      .catch((err: unknown) => {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          setFailure("network");
        }
      });
    return () => controller.abort();
  }, [activeProfileId]);

  const days = useMemo(() => data?.days ?? [], [data]);

  const heatmapData = useMemo(
    () =>
      days.map((row) => ({ date: row.day, value: minutes(row.seconds) })),
    [days]
  );
  const heatmapConfig = useMemo<ChartConfig>(
    () => ({
      minutes: {
        label: t("minutos"),
        colors: {
          light: ["#bfdbfe", "#60a5fa", "#2563eb", "#1e3a8a"],
          dark: ["#0d2a4d", "#1d4ed8", "#3b82f6", "#93c5fd"],
        },
      },
    }),
    [t]
  );

  // Series del bloque: "minutes" del periodo + "previous" del periodo anterior,
  // para que la gráfica compare en vez de mostrar una sola línea.
  const barData = useMemo(() => {
    if (range === "7d" || range === "15d") {
      const count = range === "7d" ? 7 : 15;
      const current = lastDays(days, count);
      const previous = lastDays(days, count * 2).slice(0, count);
      return current.map((point, index) => ({
        label: point.label,
        minutes: point.value,
        previous: previous[index]?.value ?? 0,
      }));
    }
    if (range === "month") {
      // Cada mes del año en curso contra el mismo mes del año anterior.
      return (data?.months ?? []).map((row) => ({
        label: new Date(Date.UTC(2020, row.month - 1, 1)).toLocaleDateString(
          undefined,
          { month: "short" }
        ),
        minutes: minutes(row.current),
        previous: minutes(row.previous),
      }));
    }
    return [];
  }, [data?.months, days, range]);

  const seriesConfig = useMemo(
    () => ({
      minutes: {
        label: t("Este periodo"),
        colors: { light: ["#2563eb"], dark: ["#60a5fa"] },
      },
      previous: {
        label: t("Periodo anterior"),
        colors: { light: ["#22d3ee"], dark: ["#67e8f9"] },
      },
    }),
    [t]
  ) as BarChartConfig & AreaChartConfig;

  const monthConfig = useMemo(
    () => ({
      // Dos azules: el año en curso más claro, el anterior más profundo.
      minutes: {
        label: t("Este año"),
        colors: { light: ["#2563eb"], dark: ["#60a5fa"] },
      },
      previous: {
        label: t("Año anterior"),
        colors: { light: ["#93c5fd"], dark: ["#2563eb"] },
      },
    }),
    [t]
  ) as BarChartConfig;

  // Mes con más minutos de este año (el "pico" que encabeza la tarjeta).
  const peakMonth = useMemo(() => {
    const rows = (data?.months ?? []).map((row) => ({
      label: new Date(Date.UTC(2020, row.month - 1, 1)).toLocaleDateString(
        undefined,
        { month: "long" }
      ),
      minutes: minutes(row.current),
    }));
    return rows.reduce(
      (best, row) => (row.minutes > best.minutes ? row : best),
      rows[0] ?? { label: "", minutes: 0 }
    );
  }, [data?.months]);

  if (failure) {
    return (
      <section className="rounded-(--radius) border border-border border-dashed p-4">
        <h2 className="font-semibold text-base">
          {t("Estadísticas")}
          {activeProfile ? (
            <span className="text-muted-foreground"> · {activeProfile.name}</span>
          ) : null}
        </h2>
        <p className="mt-1 text-muted-foreground text-sm">
          {t("No pudimos cargar tus estadísticas.")}
        </p>
      </section>
    );
  }

  // Fondo del título más visto (backdrop de TMDB) para la tarjeta compartible.
  const heroBackground = tmdbImage(
    data?.top[0]?.background ?? data?.top[0]?.poster ?? undefined,
    "w1280"
  );

  async function downloadCard() {
    const node = cardRef.current;
    if (!node || downloading) {
      return;
    }
    setDownloading(true);
    const target = RATIOS.find((item) => item.id === ratio);
    const framed = Boolean(target && "width" in target);
    // El borde discontinuo no debe salir en la imagen. En los formatos
    // compuestos la franja de la foto también se oculta: la foto pasa al fondo
    // del lienzo y el contenido se dibuja encima sin tarjeta.
    const previousBorder = node.style.border;
    const hero = heroRef.current;
    const previousDisplay = hero?.style.display ?? "";
    node.style.border = "none";
    if (framed && hero) {
      hero.style.display = "none";
    }
    try {
      const raw = await toPng(node, {
        cacheBust: true,
        pixelRatio: 2,
        ...(framed ? {} : { backgroundColor: "#0b0b0b" }),
      });
      let dataUrl = raw;
      if (target && "width" in target) {
        dataUrl = await composeFramed(
          raw,
          target.width,
          target.height,
          heroBackground ?? null
        );
      }
      const link = document.createElement("a");
      link.download = `onevid-estadisticas-${activeProfile?.name ?? "perfil"}.png`;
      link.href = dataUrl;
      link.click();
    } catch {
      toast.error(t("No se pudo generar la imagen."));
    } finally {
      node.style.border = previousBorder;
      if (hero) {
        hero.style.display = previousDisplay;
      }
      setDownloading(false);
    }
  }

  const total = hours(data?.totals.seconds ?? 0);

  return (
    <div className="flex flex-col gap-2">
      <section
        className="flex flex-col gap-3 overflow-hidden rounded-(--radius) border border-border border-dashed p-4"
        ref={cardRef}
      >
        {heroBackground ? (
          // Franja con el backdrop del título más visto. Usa la misma
          // relación de aspecto que los backdrops de TMDB (16:9), así entra la
          // imagen completa y no se corta la cara de nadie.
          <div
            className="relative -mx-4 -mt-4 mb-1 aspect-video overflow-hidden"
            ref={heroRef}
          >
            {/* biome-ignore lint/performance/noImgElement: backdrop remoto de TMDB */}
            <img
              alt=""
              aria-hidden
              className="absolute inset-0 size-full object-cover object-center opacity-90"
              src={heroBackground}
            />
            <div
              aria-hidden
              className="absolute inset-0 bg-gradient-to-t from-background via-background/5 to-transparent"
            />
          </div>
        ) : null}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold text-base">
              {t("Estadísticas")}
              {activeProfile ? (
                <span className="text-muted-foreground"> · {activeProfile.name}</span>
              ) : null}
            </h2>
            <p className="text-muted-foreground text-xs">
              {range === "7d"
                ? t("Últimos 7 días")
                : range === "15d"
                  ? t("Últimos 15 días")
                  : range === "month"
                    ? t("Minutos vistos por mes")
                    : t("Minutos vistos por día")}
            </p>
          </div>
          <div className="flex items-center gap-1 rounded-full border border-border p-0.5">
            {(
              [
                ["7d", t("7 días")],
                ["15d", t("15 días")],
                ["month", t("Mes")],
                ["year", t("Año")],
              ] as const
            ).map(([value, label]) => (
              <button
                aria-pressed={range === value}
                className={cn(
                  "rounded-full px-2.5 py-1 text-xs transition-colors",
                  range === value
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground"
                )}
                key={value}
                onClick={() => setRange(value)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-baseline gap-2">
          <span className="font-semibold text-2xl tabular-nums">{total}</span>
          <span className="text-muted-foreground text-sm">{t("horas")}</span>
          <span className="ml-auto text-muted-foreground text-xs tabular-nums">
            {data?.totals.activeDays ?? 0} {t("días activos")}
          </span>
        </div>

        {range === "year" ? (
          <EChartsHeatmapChart
            className="h-44 w-full"
            config={heatmapConfig}
            data={heatmapData}
            onSelectionChange={setSelectedDay}
            range={new Date().getFullYear()}
            thresholds={[30, 60, 90]}
          >
            <EChartsHeatmapChart.Cell dataKey="minutes" gap={2} isClickable radius={2} />
            <EChartsHeatmapChart.MonthLabel />
            <EChartsHeatmapChart.DayLabel />
            <EChartsHeatmapChart.Tooltip variant="frosted-glass" />
            <EChartsHeatmapChart.Legend lessLabel={t("Poco")} moreLabel={t("Mucho")} />
          </EChartsHeatmapChart>
        ) : range === "month" ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-muted-foreground text-xs">
                  {t("Mejor mes")}
                </span>
                <div className="flex items-baseline gap-1.5">
                  <span className="font-semibold text-blue-400 text-xl tabular-nums dark:text-blue-300">
                    {peakMonth.minutes}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {t("min")} · {peakMonth.label}
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5 pt-0.5">
                <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className="size-2.5 rounded-[3px] bg-[#2563eb] dark:bg-[#60a5fa]" />
                  {t("Este año")}
                </span>
                <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className="size-2.5 rounded-[3px] bg-[#93c5fd] dark:bg-[#2563eb]" />
                  {t("Año anterior")}
                </span>
              </div>
            </div>
            <div className="h-36 w-full">
              <EChartsBarChart
                barRadius={6}
                className="h-full w-full"
                config={monthConfig}
                data={barData}
                xDataKey="label"
              >
                <EChartsBarChart.XAxis dataKey="label" hideDots />
                <EChartsBarChart.Tooltip />
                <EChartsBarChart.Bar dataKey="previous" radius={6} />
                <EChartsBarChart.Bar dataKey="minutes" radius={6} />
              </EChartsBarChart>
            </div>
          </div>
        ) : (
          <div className="h-44 w-full">
            <EChartsAreaChart
              className="h-full w-full"
              config={seriesConfig}
              curveType="linear"
              data={barData}
              enableHoverHighlight
              xDataKey="label"
            >
              <EChartsAreaChart.Grid />
              <EChartsAreaChart.XAxis dataKey="label" hideDots />
              <EChartsAreaChart.Tooltip />
              <EChartsAreaChart.Area
                dataKey="previous"
                isClickable
                strokeVariant="dashed"
                variant="gradient"
              />
              <EChartsAreaChart.Area
                dataKey="minutes"
                isClickable
                strokeVariant="solid"
                variant="gradient"
              />
            </EChartsAreaChart>
          </div>
        )}


        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-muted/40 px-2 py-1.5">
            <p className="font-semibold text-sm tabular-nums">
              {data?.streak.current ?? 0}
            </p>
            <p className="text-[11px] text-muted-foreground">{t("Racha")}</p>
          </div>
          <div className="rounded-lg bg-muted/40 px-2 py-1.5">
            <p className="font-semibold text-sm tabular-nums">
              {data?.streak.longest ?? 0}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {t("Racha máxima")}
            </p>
          </div>
          <div className="rounded-lg bg-muted/40 px-2 py-1.5">
            <p className="font-semibold text-sm tabular-nums">
              {minutes(
                (data?.byType.movie ?? 0) + (data?.byType.series ?? 0)
              )}
            </p>
            <p className="text-[11px] text-muted-foreground">{t("min totales")}</p>
          </div>
        </div>

        {data?.titlesLocked ? (
          <p className="text-muted-foreground text-xs">
            {t(
              "Los títulos vistos se ocultan en perfiles con PIN. Verifícalo para verlos."
            )}
          </p>
        ) : null}

        {data ? (
          <div className="flex items-center gap-2 text-xs">
            <span className="rounded-full bg-blue-500/15 px-2 py-1 text-blue-300">
              {t("Películas")} · {minutes(data.byType.movie)} {t("min")}
            </span>
            <span className="rounded-full bg-cyan-500/15 px-2 py-1 text-cyan-300">
              {t("Series")} · {minutes(data.byType.series)} {t("min")}
            </span>
          </div>
        ) : null}

        {data && data.top.length > 0 ? (
          <div className="flex flex-col gap-1">
            <p className="text-muted-foreground text-xs">{t("Más vistos")}</p>
            {data.top.map((item) => (
              <div
                className="flex items-center justify-between gap-2 text-sm"
                key={`${item.mediaType}-${item.mediaId}`}
              >
                <span className="truncate">
                  {item.name}
                  {item.mediaType === "series" && item.episodes > 1
                    ? ` · ${item.episodes} ${t("capítulos")}`
                    : ""}
                </span>
                <span className="text-muted-foreground text-xs tabular-nums">
                  {minutes(item.positionSec)} {t("min")}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        <p className="w-full text-center text-muted-foreground text-[11px] tracking-wide">
          onevid.hackw.tech
        </p>
      </section>
      <div className="flex items-center gap-2">
        <Select
          onValueChange={(value) =>
            setRatio(value as (typeof RATIOS)[number]["id"])
          }
          value={ratio}
        >
          <SelectTrigger
            aria-label={t("Relación de aspecto")}
            className="h-8 w-auto min-w-0 rounded-full bg-background px-3 text-xs"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end" className="min-w-28 rounded-lg">
            {RATIOS.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {t(item.label)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <button
          className="inline-flex items-center justify-center gap-1.5 rounded-full border border-border bg-background/60 px-3 py-1.5 text-xs transition-colors hover:bg-muted disabled:opacity-50"
          disabled={downloading || !data}
          onClick={() => void downloadCard()}
          type="button"
        >
          {downloading ? t("Generando…") : t("Descargar como imagen")}
        </button>
      </div>
    </div>
  );
}
