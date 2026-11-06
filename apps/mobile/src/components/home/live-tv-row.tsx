import { useQuery } from '@tanstack/react-query';
import { ChannelRow, ChannelRowsSkeleton } from '@/components/channel-row';
import { liveTvRowChannelsQueryOptions } from '@/lib/live-tv';

// Mismo tope que la fila de Live TV de la web.
const LIVE_ROW_CHANNEL_LIMIT = 10;

/**
 * Carrusel de canales para las filas `kind: "live"` del feed configurado en la
 * web. Sin esto, la app recibe la fila (sin items de TMDB) y no pinta nada.
 */
export function LiveTvRow({
  title,
  sourceId,
  group,
  enabled = true,
}: {
  title: string;
  sourceId?: string;
  group?: string;
  enabled?: boolean;
}) {
  const query = useQuery(
    liveTvRowChannelsQueryOptions(
      sourceId ?? '',
      group,
      LIVE_ROW_CHANNEL_LIMIT,
      enabled,
    ),
  );
  const channels = query.data ?? [];

  if (query.isLoading) return <ChannelRowsSkeleton rows={1} />;

  // Fila vacía o sin fuente configurada: se oculta, igual que PosterRow.
  if (channels.length === 0) return null;

  return <ChannelRow channels={channels} title={title} />;
}
