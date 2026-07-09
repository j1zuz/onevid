import { useQuery } from '@tanstack/react-query';
import { Card, Chip, PressableFeedback, Skeleton, Typography } from 'heroui-native';
import { Check, Globe2, HardDrive } from 'lucide-react-native';
import { ScrollView, View } from 'react-native';
import { useTvFocus, tvFocusRing } from '@/hooks/use-tv-focus';
import { apiFetch } from '@/lib/api';
import { WatchProvidersNotice } from '@/components/watch-providers';

export interface StreamSource {
  title: string;
  url: string;
  description?: string;
  name?: string;
  addonId: string;
  addonName: string;
  sourceIndex: number;
  behaviors?: string[];
}

export interface SourcesResponse {
  sources: StreamSource[];
  addonErrors: { addonId: string; addonName: string; error: string }[];
  totalAddonsTried: number;
}

/**
 * Opciones de query compartidas para pedir las fuentes de un título. Las usan
 * `SourcesList`, el prefetch del detalle y el auto-play del reproductor con la
 * MISMA `queryKey`, así que comparten caché (sin fetches duplicados).
 */
export function sourcesQueryOptions(
  type: 'movie' | 'series',
  id: string,
  season?: string,
  episode?: string,
) {
  const compoundId =
    type === 'series' && season && episode
      ? `${id}:${season}:${episode}`
      : id;
  return {
    queryKey: ['sources', compoundId, type] as const,
    queryFn: () =>
      apiFetch<SourcesResponse>('/api/stream/sources', {
        method: 'POST',
        body: JSON.stringify({ id: compoundId, type }),
      }),
  };
}

/**
 * Lista de fuentes de streaming (skeleton + estados de error/vacío + tarjetas).
 * Reutilizable: en móvil va en la pantalla /sources a pantalla completa; en TV
 * se muestra inline en el detalle (panel lateral) sin navegar a otra página.
 */
export function SourcesList({
  type,
  id,
  season,
  episode,
  onSelect,
  selectedUrl,
}: {
  type: 'movie' | 'series';
  id: string;
  season?: string;
  episode?: string;
  onSelect: (source: StreamSource) => void;
  /** URL de la fuente que se está reproduciendo ahora, para marcarla. */
  selectedUrl?: string;
}) {
  const query = useQuery({
    ...sourcesQueryOptions(type, id, season, episode),
    enabled: Boolean(id),
  });

  const loading = query.isLoading;
  const error = query.isError
    ? query.error instanceof Error
      ? query.error.message
      : 'No pudimos cargar las fuentes.'
    : null;
  const data = query.data;

  return (
    <ScrollView
      contentContainerStyle={{
        paddingHorizontal: 16,
        gap: 12,
        paddingBottom: 32,
      }}
    >
      {loading
        ? Array.from({ length: 4 }).map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder
            <Skeleton key={i} style={{ height: 100, borderRadius: 16 }} />
          ))
        : null}

      {!loading && error ? (
        <Card>
          <Card.Body>
            <Typography type="body-sm" color="muted" align="center">
              {error}
            </Typography>
          </Card.Body>
        </Card>
      ) : null}

      {!loading && data && data.sources.length === 0 ? (
        <Card>
          <Card.Body className="gap-3">
            <WatchProvidersNotice
              type={type}
              id={id}
              fallback={
                <>
                  <Typography type="h5" align="center">
                    Sin fuentes disponibles
                  </Typography>
                  <Typography type="body-sm" color="muted" align="center">
                    {data.totalAddonsTried === 0
                      ? 'No tienes addons instalados. Agrégalos en hackw.tech.'
                      : `Se consultaron ${data.totalAddonsTried} addon(s) y ninguno devolvió resultados.`}
                  </Typography>
                </>
              }
            />
            {data.addonErrors.length > 0 ? (
              <View style={{ gap: 6, marginTop: 4 }}>
                {data.addonErrors.map((ae) => (
                  <View
                    key={ae.addonId}
                    style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}
                  >
                    <Globe2 size={14} color="#888" />
                    <Typography type="body-xs" color="muted">
                      {ae.addonName}: {humanizeAddonError(ae.error)}
                    </Typography>
                  </View>
                ))}
              </View>
            ) : null}
          </Card.Body>
        </Card>
      ) : null}

      {!loading && data
        ? data.sources.map((s) => (
            <SourceCard
              key={`${s.addonId}:${s.sourceIndex}`}
              source={s}
              selected={Boolean(selectedUrl) && s.url === selectedUrl}
              onPress={() => onSelect(s)}
            />
          ))
        : null}
    </ScrollView>
  );
}

function SourceCard({
  source,
  onPress,
  selected,
}: {
  source: StreamSource;
  onPress: () => void;
  selected?: boolean;
}) {
  // `behaviors` trae las líneas de detalle del addon (códec, idiomas, tamaño,
  // uploader, etc.) que el backend reenvía desde `metadata`. Sin esto la tarjeta
  // se ve vacía aunque la info ya llegue.
  const behaviors = source.behaviors ?? [];
  const lines = [
    source.title,
    source.description,
    source.name,
    ...behaviors,
  ].filter((l): l is string => Boolean(l));
  const haystack = `${source.title} ${source.description ?? ''} ${behaviors.join(' ')}`;
  const quality = extractQuality(source.title);
  const size = extractSize(haystack);
  const { focused, focusProps } = useTvFocus();

  return (
    <PressableFeedback onPress={onPress} {...focusProps}>
      <Card
        style={[
          tvFocusRing(focused),
          selected ? { borderWidth: 1.5, borderColor: '#7CFC9B' } : null,
        ]}
      >
        <Card.Body className="gap-2">
          <View
            style={{
              flexDirection: 'row',
              gap: 8,
              flexWrap: 'wrap',
              alignItems: 'center',
            }}
          >
            {selected ? (
              <View
                style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
              >
                <Check size={14} color="#7CFC9B" />
                <Typography
                  type="body-xs"
                  weight="semibold"
                  style={{ color: '#7CFC9B' }}
                >
                  Reproduciendo
                </Typography>
              </View>
            ) : null}
            {quality ? (
              <Chip variant="primary" size="sm">
                <Chip.Label>{quality}</Chip.Label>
              </Chip>
            ) : null}
            {size ? (
              <Chip variant="soft" size="sm">
                <HardDrive size={12} color="#fff" />
                <Chip.Label>{size}</Chip.Label>
              </Chip>
            ) : null}
            <Chip variant="soft" size="sm">
              <Globe2 size={12} color="#fff" />
              <Chip.Label>{source.addonName}</Chip.Label>
            </Chip>
          </View>
          {lines.map((line, i) => (
            <Typography
              // biome-ignore lint/suspicious/noArrayIndexKey: static text
              key={i}
              type="body-sm"
              color={i === 0 ? 'default' : 'muted'}
            >
              {line}
            </Typography>
          ))}
        </Card.Body>
      </Card>
    </PressableFeedback>
  );
}

// Traduce los errores técnicos de los addons a mensajes claros en español.
function humanizeAddonError(error: string): string {
  const e = error.toLowerCase();
  if (e.includes('abort') || e.includes('timeout') || e.includes('timed out')) {
    return 'tardó demasiado en responder';
  }
  if (e.includes('http 404')) return 'no encontró este título';
  if (e.includes('http 401') || e.includes('http 403')) {
    return 'requiere reconfigurar el addon';
  }
  if (/http 5\d\d/.test(e)) return 'el servidor del addon falló';
  if (
    e.includes('network') ||
    e.includes('fetch failed') ||
    e.includes('econnrefused') ||
    e.includes('enotfound')
  ) {
    return 'no responde (sin conexión)';
  }
  return 'no devolvió resultados';
}

function extractQuality(s: string): string | null {
  const m = s.match(/\b(4K|2160p|1080p|720p|480p|HD)\b/i);
  return m ? m[1].toUpperCase() : null;
}

function extractSize(s: string): string | null {
  const m = s.match(/(\d+(?:\.\d+)?\s?(?:GB|MB))/i);
  return m ? m[1] : null;
}
