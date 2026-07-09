import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { PressableFeedback, Skeleton, Typography } from 'heroui-native';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, View } from 'react-native';
import { useTvFocus, tvFocusRing } from '@/hooks/use-tv-focus';
import { apiFetch } from '@/lib/api';

export interface WatchProvider {
  id: number;
  name: string;
  logo?: string;
}

export interface WatchProvidersResponse {
  /** Plataformas de streaming por suscripción (categoría `flatrate` de TMDB). */
  flatrate: WatchProvider[];
  /** Enlace a la página de TMDB/JustWatch de la región. */
  link?: string;
  region: string;
}

/**
 * Query de las plataformas de streaming donde está disponible un título. El `id`
 * debe ser el id base de TMDB (no el compuesto `id:season:episode`): los
 * proveedores son por título, no por episodio.
 */
export function watchProvidersQueryOptions(
  type: 'movie' | 'series',
  id: string,
  lang?: string,
) {
  return {
    queryKey: ['watch-providers', id, type, lang] as const,
    queryFn: () =>
      apiFetch<WatchProvidersResponse>(
        `/api/watch-providers?type=${type}&id=${encodeURIComponent(id)}`,
      ),
  };
}

/**
 * Aviso "dónde ver" que reemplaza al mensaje de "sin fuentes disponibles":
 * cuando la app no tiene fuentes propias para reproducir, muestra en qué
 * plataformas de streaming está el título (datos de JustWatch vía TMDB).
 *
 * Si no hay proveedores para la región (o falla la consulta) cae en `fallback`,
 * que el llamador usa para conservar el mensaje original (p. ej. "no tienes
 * addons instalados").
 */
export function WatchProvidersNotice({
  type,
  id,
  fallback,
}: {
  type: 'movie' | 'series';
  id: string;
  fallback?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const query = useQuery({
    ...watchProvidersQueryOptions(type, id, i18n.language),
    enabled: Boolean(id),
  });

  if (query.isLoading) {
    return (
      <View style={{ gap: 12, alignItems: 'center' }}>
        <Typography type="h5" align="center">
          {t('Medios disponibles')}
        </Typography>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton
              // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder
              key={i}
              style={{ width: 52, height: 52, borderRadius: 12 }}
            />
          ))}
        </View>
      </View>
    );
  }

  const providers = query.data?.flatrate ?? [];
  const link = query.data?.link;

  if (providers.length === 0) {
    return <>{fallback ?? null}</>;
  }

  const openLink = () => {
    if (link) {
      Linking.openURL(link).catch(() => {
        /* enlace no disponible: ignorar */
      });
    }
  };

  return (
    <View style={{ gap: 12, alignItems: 'center' }}>
      <Typography type="h5" align="center">
        {t('Medios disponibles')}
      </Typography>
      <Typography type="body-sm" color="muted" align="center">
        {t('No hay fuentes de streaming en la app. Míralo en:')}
      </Typography>
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          justifyContent: 'center',
          gap: 12,
        }}
      >
        {providers.map((p) => (
          <ProviderLogo key={p.id} provider={p} onPress={openLink} />
        ))}
      </View>
      <Typography type="body-xs" color="muted" align="center">
        {t('Datos de JustWatch')}
      </Typography>
    </View>
  );
}

function ProviderLogo({
  provider,
  onPress,
}: {
  provider: WatchProvider;
  onPress: () => void;
}) {
  const { focused, focusProps } = useTvFocus();
  return (
    <PressableFeedback onPress={onPress} {...focusProps}>
      <View
        style={[
          {
            width: 56,
            height: 56,
            borderRadius: 14,
            overflow: 'hidden',
            backgroundColor: 'rgba(255,255,255,0.06)',
            alignItems: 'center',
            justifyContent: 'center',
          },
          tvFocusRing(focused),
        ]}
      >
        {provider.logo ? (
          <Image
            source={provider.logo}
            contentFit="contain"
            cachePolicy="memory-disk"
            accessibilityLabel={provider.name}
            style={{ width: '100%', height: '100%' }}
          />
        ) : (
          <Typography type="body-xs" align="center" numberOfLines={2}>
            {provider.name}
          </Typography>
        )}
      </View>
    </PressableFeedback>
  );
}
