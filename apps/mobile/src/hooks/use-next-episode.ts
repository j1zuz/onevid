import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/lib/api';

interface EpisodeRef {
  name: string;
  number: number;
  season: number;
}

interface SeasonMeta {
  episodes: { name?: string; number?: number; season?: number }[];
  seasons: number[];
}

function seasonQueryOptions(id: string, season: number, lang: string) {
  return {
    // Misma queryKey que el detalle y el selector de episodios: si el usuario
    // acaba de ver la lista de esta temporada, el siguiente episodio sale de
    // caché y el botón aparece sin pedir nada a la red.
    queryKey: ['series-season', id, season, lang] as const,
    queryFn: () =>
      apiFetch<SeasonMeta>(
        `/api/series-meta?id=${encodeURIComponent(id)}&season=${season}`,
      ),
  };
}

/**
 * Resuelve el episodio que sigue al que se está viendo, o `null` si es el último
 * de la serie. Salta de temporada cuando hace falta: al terminar el final de una
 * temporada, el siguiente es el primer episodio de la próxima.
 *
 * Equivalente móvil de `useNextEpisode` de la web, pero sobre React Query para
 * reaprovechar la caché de temporadas que ya llenan el detalle y el selector de
 * episodios.
 */
export function useNextEpisode(
  id: string | undefined,
  season: number,
  episode: number,
  enabled: boolean,
): EpisodeRef | null {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const active = Boolean(enabled && id && season > 0 && episode > 0);

  const current = useQuery({
    ...seasonQueryOptions(id ?? '', season, lang),
    enabled: active,
  });

  const inSameSeason = current.data?.episodes?.find(
    (ep) => ep.season === season && ep.number === episode + 1,
  );

  // Solo se pide la temporada siguiente cuando la actual ya se agotó: mientras
  // queden episodios por delante, esta query ni se lanza.
  const followingSeason = current.data?.seasons?.find((s) => s > season) ?? null;
  const next = useQuery({
    ...seasonQueryOptions(id ?? '', followingSeason ?? 0, lang),
    enabled: active && !inSameSeason && followingSeason != null,
  });

  if (!active) {
    return null;
  }

  if (inSameSeason?.number) {
    return {
      season,
      number: inSameSeason.number,
      name: inSameSeason.name ?? '',
    };
  }

  if (followingSeason == null) {
    return null;
  }

  const first = (next.data?.episodes ?? [])
    .filter((ep) => typeof ep.number === 'number' && ep.number > 0)
    .sort((a, b) => (a.number ?? 0) - (b.number ?? 0))[0];

  return first?.number
    ? { season: followingSeason, number: first.number, name: first.name ?? '' }
    : null;
}
