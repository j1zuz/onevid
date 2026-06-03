import { router, useLocalSearchParams } from 'expo-router';
import { Card, Chip, Skeleton, Typography } from 'heroui-native';
import { ArrowLeft, Globe2, HardDrive, Volume2 } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiFetch } from '@/lib/api';
import { COLORS } from '@/lib/theme';

interface StreamSource {
  title: string;
  url: string;
  description?: string;
  name?: string;
  addonId: string;
  addonName: string;
  sourceIndex: number;
  behaviors?: string[];
}

interface SourcesResponse {
  sources: StreamSource[];
  addonErrors: Array<{ addonId: string; addonName: string; error: string }>;
  totalAddonsTried: number;
}

export default function SourcesPage() {
  const params = useLocalSearchParams<{
    type: string;
    id: string;
    season?: string;
    episode?: string;
  }>();
  const type = params.type === 'series' ? 'series' : 'movie';
  const id = params.id ?? '';
  const compoundId =
    type === 'series' && params.season && params.episode
      ? `${id}:${params.season}:${params.episode}`
      : id;

  const [data, setData] = useState<SourcesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiFetch<SourcesResponse>('/api/stream/sources', {
      method: 'POST',
      body: JSON.stringify({ id: compoundId, type }),
    })
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(
            e instanceof Error ? e.message : 'No pudimos cargar las fuentes.',
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [compoundId, id, type]);

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <SafeAreaView edges={['top']} style={{ paddingHorizontal: 16 }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            paddingVertical: 12,
          }}
        >
          <Pressable
            onPress={() => router.back()}
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: 'rgba(255,255,255,0.1)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ArrowLeft size={22} color="#fff" />
          </Pressable>
          <Typography type="h4" weight="bold">
            Fuentes
          </Typography>
        </View>
      </SafeAreaView>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, gap: 12, paddingBottom: 32 }}>
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder
            <Skeleton key={i} style={{ height: 100, borderRadius: 16 }} />
          ))
        ) : null}

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
              <Typography type="h5" align="center">
                Sin fuentes disponibles
              </Typography>
              <Typography type="body-sm" color="muted" align="center">
                {data.totalAddonsTried === 0
                  ? 'No tienes addons instalados. Agrégalos en hackw.tech.'
                  : `Se consultaron ${data.totalAddonsTried} addon(s) y ninguno devolvió resultados.`}
              </Typography>
              {data.addonErrors.length > 0 ? (
                <View style={{ gap: 6, marginTop: 4 }}>
                  {data.addonErrors.map((ae) => (
                    <View
                      key={ae.addonId}
                      style={{
                        flexDirection: 'row',
                        gap: 8,
                        alignItems: 'center',
                      }}
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
              <SourceCard key={`${s.addonId}:${s.sourceIndex}`} source={s} />
            ))
          : null}
      </ScrollView>
    </View>
  );
}

function SourceCard({ source }: { source: StreamSource }) {
  const lines = [source.title, source.description, source.name].filter(
    (l): l is string => Boolean(l),
  );
  const quality = extractQuality(source.title);
  const size = extractSize(source.title + ' ' + (source.description ?? ''));
  const audio = extractAudio(source.title + ' ' + (source.description ?? ''));

  return (
    <Pressable
      onPress={() =>
        router.push({
          pathname: '/player',
          params: { url: source.url, title: source.title },
        })
      }
    >
      <Card>
        <Card.Body className="gap-2">
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
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
            {audio ? (
              <Chip variant="soft" size="sm">
                <Volume2 size={12} color="#fff" />
                <Chip.Label>{audio}</Chip.Label>
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
    </Pressable>
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

function extractAudio(s: string): string | null {
  const m = s.match(/\b(DD\+|DDP|DD|DTS|AC3|AAC|FLAC|TrueHD|Atmos)\b/i);
  return m ? m[1] : null;
}
