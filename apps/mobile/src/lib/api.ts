import i18next from 'i18next';
import { getActiveProfileId } from './active-profile';
import { track } from './analytics';
import {
  API_URL,
  appClientHeaders,
  clearAccessToken,
  getAccessToken,
} from './auth';

// Rewrite TMDB image URLs to higher resolution. Backend defaults to smaller
// sizes (w300 for stills, w780 for backdrops) which are blurry on HiDPI mobile
// screens. Pass `targetSize` for the desired bucket; default 'w780' suits
// medium images, 'w1280' is best for hero/full-width.
const TMDB_SIZE_RE =
  /image\.tmdb\.org\/t\/p\/(w92|w154|w185|w300|w342|w500|w780|w1280|original)\//;

export function tmdbImage(
  url: string | undefined,
  targetSize: 'w185' | 'w300' | 'w500' | 'w780' | 'w1280' | 'original' = 'w780',
): string | undefined {
  if (!url) return url;
  return url.replace(TMDB_SIZE_RE, `image.tmdb.org/t/p/${targetSize}/`);
}

export interface CastMember {
  id: string;
  name: string;
  character?: string;
  profile?: string;
}

export interface NetworkInfo {
  id: number;
  name: string;
  logo?: string;
}

export interface MediaMeta {
  id: string;
  name: string;
  type: 'movie' | 'series';
  year?: string;
  poster?: string;
  background?: string;
  description?: string;
  genres?: string[];
  imdbId?: string;
  imdbRating?: string;
  logo?: string;
  cast?: CastMember[];
  director?: string[];
  networks?: NetworkInfo[];
  status?: string;
  runtime?: number;
  episodeRunTime?: number;
  releaseDate?: string;
  related?: MediaMeta[];
}

/**
 * Una fila del feed de inicio, tal como la devuelve
 * `/api/onevid-feed/sections`: el usuario la configura en la web y la app pinta
 * exactamente las mismas filas, con su título e items ya resueltos.
 */
export interface FeedSection {
  /** Ruta de la vista "Ver todo" en la web; la app no la usa por ahora. */
  href: string;
  id: string;
  items: MediaMeta[];
  title: string;
}

export interface FeedSectionsResponse {
  /** false = el usuario nunca guardó su feed y esto es el preset por defecto. */
  configured: boolean;
  /** "network" = todas las filas fallaron; el 401 de token muerto ya viene como error HTTP. */
  error: 'network' | null;
  hero: MediaMeta[];
  sections: FeedSection[];
}

// Sin esto, un fetch que se cuelga (wifi con paquetes perdidos, típico en TV
// baratas) nunca resuelve NI rechaza: la queryFn de React Query queda pendiente
// para siempre, isLoading nunca baja a false, y cualquier pantalla que
// condicione su skeleton a esa query se queda pegada aunque el resto de la
// data ya haya llegado (visto en el detalle: el fondo carga desde cache pero
// el título/sinopsis dependen también de /api/tmdb-trailer, que colgaba sin
// límite). Con el abort, el fetch SIEMPRE falla en un tiempo acotado, lo que
// permite que el retry/estado de error de React Query actúen con normalidad.
const API_TIMEOUT_MS = 15_000;

export async function apiFetch<T = unknown>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const token = await getAccessToken();
  const headers = new Headers(init?.headers);
  // Identificador de la app (User-Agent de navegador + header propio) para que
  // Cloudflare pueda dejar pasar estas solicitudes con una regla WAF Skip.
  for (const [k, v] of Object.entries(appClientHeaders())) headers.set(k, v);
  headers.set('Accept', 'application/json');
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  const profileId = getActiveProfileId();
  if (profileId && !headers.has('X-Profile-Id')) {
    headers.set('X-Profile-Id', profileId);
  }
  // Idioma actual de la app: el backend lo usa para pedir a TMDB los títulos,
  // descripciones y carátulas en ese idioma (la web usa la cookie NEXT_LOCALE;
  // como el móvil no manda cookies, lo enviamos por header). Cambia con el
  // selector de idioma de Perfil.
  if (i18next.language) {
    headers.set('X-App-Language', i18next.language);
  }
  // Telemetría de rendimiento de red: medimos la latencia de respuesta y
  // registramos éxito/error de CADA llamada en un único punto. Usamos solo la
  // ruta (sin query) como propiedad para no inflar la cardinalidad en PostHog.
  const route = path.split('?')[0];
  const startedAt = Date.now();
  const timeoutController = new AbortController();
  const timeoutTimer = setTimeout(
    () => timeoutController.abort(),
    API_TIMEOUT_MS,
  );
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers,
      signal: init?.signal ?? timeoutController.signal,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    track('api_error', {
      path: route,
      reason: 'network',
      message,
      // Clasificación del TIPO de fallo de red para poder filtrarlo en PostHog
      // sin asumir la causa: 'dns' (no resuelve el host), 'timeout' (abortado,
      // incluye los que nosotros mismos cortamos a los API_TIMEOUT_MS), u
      // 'other'. Nos deja ver QUÉ errores pasan y con qué frecuencia real.
      errorKind: /UnknownHost|Unable to resolve|ENOTFOUND/i.test(message)
        ? 'dns'
        : /abort|timeout|timed out/i.test(message)
          ? 'timeout'
          : 'other',
    });
    throw e;
  } finally {
    clearTimeout(timeoutTimer);
  }
  const latencyMs = Date.now() - startedAt;
  // Solo un 401 de un endpoint de AUTH (p. ej. /api/auth/get-session) significa
  // que la sesión expiró → limpiamos el token. Un 401 de un endpoint de
  // CONTENIDO (p. ej. el catálogo cuando el token de TMDB es inválido) NO es un
  // problema de sesión; si lo tratáramos igual, configurar mal TMDB
  // deslogueaba la app (Inicio mostraba "configurar" pero Perfil pedía login).
  if (res.status === 401 && path.startsWith('/api/auth/')) {
    await clearAccessToken();
  }
  if (res.status === 204) {
    track('api_call', { path: route, status: 204, latencyMs });
    return undefined as T;
  }
  const text = await res.text();
  if (!res.ok) {
    let message = `${path} HTTP ${res.status}`;
    try {
      const parsed = JSON.parse(text) as { error?: string };
      if (parsed?.error) message = parsed.error;
    } catch {
      /* keep default */
    }
    track('api_error', {
      path: route,
      status: res.status,
      latencyMs,
      message,
    });
    throw new Error(message);
  }
  track('api_call', { path: route, status: res.status, latencyMs });
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${path}: respuesta inválida del servidor`);
  }
}

