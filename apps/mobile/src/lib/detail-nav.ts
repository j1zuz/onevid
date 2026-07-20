import type { QueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import type { MediaMeta } from '@/lib/api';

export function navigateToDetail(queryClient: QueryClient, item: MediaMeta, lang: string) {
  const key = ['detail', item.type, item.id, lang];
  // Solo sembramos si no había ya datos (evita pisar una cache más completa de
  // una visita anterior con esta versión parcial de catálogo).
  if (queryClient.getQueryData(key) === undefined) {
    // updatedAt: 0 marca el dato como "stale" desde ya: aunque detailQuery
    // arranca con datos (poster/nombre/descripción), el observer dispara el
    // fetch real igual al montar, para completar cast/episodios/relacionados
    // que el catálogo no trae. Sin esto, el staleTime global de 5 min
    // (query.ts) dejaría la metadata incompleta hasta que expire.
    queryClient.setQueryData(key, item, { updatedAt: 0 });
  }
  router.push({ pathname: '/detail/[type]/[id]', params: { type: item.type, id: item.id } });
}
