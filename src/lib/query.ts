import { QueryClient } from '@tanstack/react-query';

/**
 * Cliente único de React Query para toda la app.
 *
 * staleTime alto (5 min) es la clave para que al salir y volver a una pantalla
 * NO se vea el skeleton: useQuery devuelve los datos cacheados al instante y,
 * si siguen "fresh", ni siquiera re-fetchea. Si están "stale", muestra el cache
 * y revalida en segundo plano (stale-while-revalidate), sin parpadeo.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 min fresh
      gcTime: 1000 * 60 * 30, // mantener en cache 30 min sin observadores
      retry: 1,
      // En RN no hay "window focus"; no re-fetchamos por foco para evitar
      // recargas innecesarias al volver del reproductor, etc.
      refetchOnWindowFocus: false,
    },
  },
});
