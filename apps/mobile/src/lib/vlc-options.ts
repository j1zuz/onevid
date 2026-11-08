import { STREAM_UA } from '@/lib/stream-url';

// Opciones de libVLC del medio. Va como CONSTANTE DE MÓDULO, no como literal
// inline en el JSX, y esto es crítico: con New Architecture, Fabric reenvía
// TODOS los props del nodo en cada update (SurfaceMountingManager.updateProps
// pasa el mapa completo, no un diff), Expo invoca cada setter sin comparar
// (ConcreteViewProp.set) y los setters nativos de `source`/`options` marcan
// `shouldInit` → OnViewDidUpdateProps llama initPlayer() → destroyPlayer() +
// createPlayer(). O sea: un array nuevo por render REINICIABA el stream desde
// cero. En TV, donde el primer fotograma tarda ~20 s (p50 medido), esos
// reinicios agotaban el watchdog de arranque y el player "saltaba" las fuentes.
// network-caching = colchón (ms) que VLC mantiene leído por delante: es a la vez
// el pre-buffer de ARRANQUE y la ventana que sostiene DURANTE todo el vídeo. Es
// un buffer de tamaño fijo, NO crece con el tiempo, y VLC no puede ampliarlo en
// caliente (cambiarlo obliga a reabrir el stream), por eso usamos un único valor
// y no dos fases. 1500 ms (antes 3000) para que el vídeo aparezca antes: es la
// espera fija que el usuario nota al dar Play. Un corte tras el primer fotograma
// lo recupera :http-reconnect y NO tira la fuente. El User-Agent de navegador
// evita 403 de hosts que rechazan el UA por defecto de VLC.
//
// OJO al vigilar esto: `player_rebuffer` estaba en 3,58 cortes por reproducción
// en teléfono (30 días, medido en PostHog) ANTES de esta bajada, y este colchón
// es justo lo que los contiene. Si esa cifra sube, hay que volver a 2500.
export const VLC_OPTIONS = [
  ':network-caching=1500',
  ':file-caching=1500',
  ':http-reconnect',
  `:http-user-agent=${STREAM_UA}`,
];

// Películas/series: el colchón de 1.5 s retrasa el primer fotograma ~1.5 s en
// cada arranque (lo que se siente como "buffering" al abrir). En VOD el archivo
// tiene un índice y se puede rebufferizar mejor, así que se baja a 800 ms: el
// vídeo aparece antes y en un móvil de 2 GB se nota. En directo se mantiene
// 1500 ms porque ahí un corte sí tira la reproducción.
export const VLC_OPTIONS_VOD = [
  ':network-caching=800',
  ':file-caching=800',
  ':http-reconnect',
  `:http-user-agent=${STREAM_UA}`,
];
