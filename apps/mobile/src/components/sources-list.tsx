import { useQuery } from '@tanstack/react-query';
import { Card, PressableFeedback, Skeleton, Typography } from 'heroui-native';
import { Check, Globe2 } from 'lucide-react-native';
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
  /** Calidad que dedujo el servidor del texto del addon. */
  quality?: keyof typeof QUALITY_LABELS;
}

// Espejo de QUALITY_LABELS de apps/web/src/lib/stream-quality.ts. No hay paquete
// compartido entre la app y el backend, y el servidor manda la clave cruda
// ('2160', '1080'…) para no atar la respuesta a un idioma.
const QUALITY_LABELS = {
  '2160': '4K',
  '1440': '1440p',
  '1080': '1080p',
  '720': '720p',
  '480': 'SD',
  unknown: 'Otras',
} as const;

const QUALITY_CHIP_STYLE = {
  alignSelf: 'flex-start',
  paddingHorizontal: 8,
  paddingVertical: 2,
  borderRadius: 6,
  backgroundColor: 'rgba(255,255,255,0.10)',
} as const;

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
    // Las URLs de addons/debrid pueden caducar o cambiar, así que la ventana de
    // reutilización es CORTA: 60 s. Es margen de sobra para el pre-warm (el
    // detalle prefetchea la lista y el usuario le da Play poco después → arranque
    // caliente) sin llegar a reutilizar un enlace viejo; pasado ese minuto se
    // refresca sola. Antes era 0/0, lo que forzaba un refetch en cada pantalla.
    staleTime: 60_000,
    gcTime: 60_000,
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
              hasAddons={data.totalAddonsTried > 0}
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
  // `behaviors` trae las líneas de detalle del addon (códec, tamaño, idiomas,
  // uploader, etc.) ya formateadas por el propio addon. No añadimos chips de
  // tamaño/addon encima: esa info ya viene en estas líneas y duplicarla se veía
  // redundante. La calidad sí va aparte: es la que decide el orden de la lista y
  // cuál abre el reproductor, así que tiene que leerse de un vistazo.
  const behaviors = source.behaviors ?? [];
  const lines = [
    source.title,
    source.description,
    source.name,
    ...behaviors,
  ].filter((l): l is string => Boolean(l));
  const { focused, focusProps } = useTvFocus();

  return (
    <PressableFeedback onPress={onPress} {...focusProps}>
      <Card style={tvFocusRing(focused)}>
        <Card.Body className="gap-2">
          {source.quality ? (
            <View style={QUALITY_CHIP_STYLE}>
              <Typography type="body-xs" weight="medium">
                {QUALITY_LABELS[source.quality]}
              </Typography>
            </View>
          ) : null}
          {lines.map((line, i) => (
            <Typography
              // biome-ignore lint/suspicious/noArrayIndexKey: static text
              key={i}
              type="body-sm"
              color={i === 0 ? 'default' : 'muted'}
              // Deja hueco para el chulito de "seleccionado" en la 1ª línea.
              style={i === 0 && selected ? { paddingRight: 28 } : undefined}
            >
              {line}
            </Typography>
          ))}
        </Card.Body>
        {/* Fuente en reproducción: solo un chulito en la esquina, sin teñir toda
            la tarjeta de verde. */}
        {selected ? (
          <View
            style={{
              position: 'absolute',
              top: 8,
              right: 8,
              width: 24,
              height: 24,
              borderRadius: 12,
              backgroundColor: '#7CFC9B',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Check size={16} color="#0a0a0a" strokeWidth={3} />
          </View>
        ) : null}
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
