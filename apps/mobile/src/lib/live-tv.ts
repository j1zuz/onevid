import { router } from 'expo-router';
import { apiFetch } from './api';

/**
 * Live TV: fuentes (M3U/Xtream) y canales configurados por el usuario en la web.
 * La app solo los consume; el alta/edición de fuentes vive en /home/account de la
 * web. Mismas rutas que usa la web, autenticadas con el Bearer de la sesión.
 */

export interface LiveTvSourceSummary {
  id: string;
  name: string;
  channelCount: number;
  type: 'm3u' | 'xtream';
  hasEpg: boolean;
}

export interface LiveTvChannel {
  id: string;
  name: string;
  url: string;
  logo?: string;
  group: string;
  tvgId?: string;
}

export interface LiveTvProgramme {
  id: string;
  title: string;
  description?: string;
  start: string;
  end: string;
}

export interface LiveTvGuideRow {
  channelId: string;
  programmes: LiveTvProgramme[];
  error?: boolean;
}

export interface LiveTvGuideResponse {
  channels: LiveTvGuideRow[];
}

/**
 * Logo de proveedor: remoto y fuera de nuestro control. Solo aceptamos HTTPS
 * sin credenciales (mismo criterio que la web) para no pintar URLs raras.
 */
export function safeChannelLogo(logo?: string): string | undefined {
  try {
    const url = new URL(logo ?? '');
    return url.protocol === 'https:' && !url.username && !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

// El backend puede tardar en refrescar un catálogo Xtream de miles de canales
// (la web usa 45 s para el listado de canales); el límite general de apiFetch
// (15 s) se queda corto en el primer arranque de una fuente grande.
const SOURCES_TIMEOUT_MS = 20_000;
const CHANNELS_TIMEOUT_MS = 60_000;

export function liveTvSourcesQueryOptions(enabled = true) {
  return {
    queryKey: ['live-tv-sources'] as const,
    queryFn: async () => {
      const data = await apiFetch<{ sources?: LiveTvSourceSummary[] }>(
        '/api/onevid-live-tv',
        undefined,
        SOURCES_TIMEOUT_MS,
      );
      return Array.isArray(data.sources) ? data.sources : [];
    },
    enabled,
    staleTime: 60_000,
    gcTime: 60 * 60_000,
  };
}

export function liveTvChannelsQueryOptions(sourceId: string, enabled = true) {
  return {
    queryKey: ['live-tv-channels', sourceId] as const,
    queryFn: async () => {
      const data = await apiFetch<{ channels?: LiveTvChannel[] }>(
        `/api/onevid-live-tv/channels?sourceId=${encodeURIComponent(sourceId)}`,
        undefined,
        CHANNELS_TIMEOUT_MS,
      );
      return Array.isArray(data.channels) ? data.channels : [];
    },
    enabled: enabled && Boolean(sourceId),
    staleTime: 5 * 60_000,
    gcTime: 60 * 60_000,
  };
}

/**
 * Abre un canal en el reproductor. `live=1` desactiva progreso/seek y la
 * descarga offline (un directo no tiene duración ni termina).
 */
export function playLiveTvChannel(channel: LiveTvChannel): void {
  // El logo va a la carátula del reproductor; si no hay (o no es HTTPS
  // válido) el player cae al nombre del canal.
  const logo = safeChannelLogo(channel.logo);
  router.push({
    pathname: '/player',
    params: {
      url: channel.url,
      title: channel.name,
      live: '1',
      ...(logo ? { logo } : {}),
    },
  });
}

/** Id compuesto y estable para guardar un canal en favoritos/ver después. */
export function buildLiveSavedId(
  sourceId: string,
  channelId: string,
): string {
  return `${sourceId}::${channelId}`;
}

export function parseLiveSavedId(
  value: unknown,
): { channelId: string; sourceId: string } | null {
  if (typeof value !== 'string' || value.length > 500) return null;
  const parts = value.split('::');
  if (parts.length !== 2) return null;
  const sourceId = parts[0]?.trim();
  const channelId = parts[1]?.trim();
  if (!sourceId || !channelId) return null;
  if (sourceId.length > 200 || channelId.length > 200) return null;
  return { sourceId, channelId };
}

/** Resuelve un canal guardado contra su fuente (el catálogo está cacheado). */
export async function resolveLiveTvChannel(
  sourceId: string,
  channelId: string,
): Promise<LiveTvChannel> {
  const response = await apiFetch<{ channel?: LiveTvChannel }>(
    `/api/onevid-live-tv/channel?sourceId=${encodeURIComponent(
      sourceId,
    )}&channelId=${encodeURIComponent(channelId)}`,
  );
  if (!response.channel) throw new Error('Canal no disponible');
  return response.channel;
}

/** Abre un canal guardado desde la Biblioteca. */
export async function playSavedLiveChannel(
  sourceId: string,
  channelId: string,
): Promise<void> {
  const channel = await resolveLiveTvChannel(sourceId, channelId);
  playLiveTvChannel(channel);
}

/**
 * Canales de una fila "Live TV" del feed (Inicio/Descubrir). El endpoint
 * filtra por categoría y recorta en el servidor: no descargamos el catálogo
 * completo de miles de canales solo para pintar 10 tarjetas.
 */
export function liveTvRowChannelsQueryOptions(
  sourceId: string,
  group: string | undefined,
  limit = 10,
  enabled = true,
) {
  // Query armada a mano: el polyfill de URLSearchParams en RN es incompleto
  // (ver catalog-nav.ts) y aquí no queremos depender de `.set`/`.toString`.
  const query = [
    `sourceId=${encodeURIComponent(sourceId)}`,
    `limit=${limit}`,
    ...(group ? [`group=${encodeURIComponent(group)}`] : []),
  ].join('&');
  return {
    queryKey: ['live-tv-channels', 'row', sourceId, group ?? '', limit] as const,
    queryFn: async () => {
      const data = await apiFetch<{ channels?: LiveTvChannel[] }>(
        `/api/onevid-live-tv/channels?${query}`,
        undefined,
        CHANNELS_TIMEOUT_MS,
      );
      return Array.isArray(data.channels) ? data.channels.slice(0, limit) : [];
    },
    enabled: enabled && Boolean(sourceId),
    staleTime: 5 * 60_000,
    gcTime: 60 * 60_000,
  };
}
