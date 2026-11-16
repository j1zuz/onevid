/*
 * Service worker de OneVid.
 *
 * Objetivo: que la PWA abra y permita reproducir las descargas sin conexión
 * cuando el usuario pierde internet. No intenta cachear el catálogo entero ni
 * las APIs: cachea el shell de la app y las páginas que el usuario ya visitó,
 * y deja que /offline (precacheado) haga de biblioteca local con OPFS.
 *
 * Reglas:
 *  - APIs (/api/*), telemetría y respuestas con `Range` nunca se cachean.
 *  - Navegaciones: network-first con timeout corto; si falla, página cacheada
 *    y, en último caso, /offline.
 *  - Assets estáticos (/_next/static, imágenes, fuentes): cache-first.
 *  - Imágenes remotas (pósters de TMDB): cache-first best-effort.
 */

// Al cambiar estrategias, rutas o nombres de caché hay que subir VERSION: en
// `activate` se borran las cachés que no empiecen por ella.
//
// v2: /offline/play pasó del <video controls> nativo al player con el skin de
// Video.js. El HTML y los chunks de esa página viven en la caché del shell, así
// que sin subir VERSION quien estuviera offline seguía viendo el reproductor
// viejo (el nuevo solo aparecía con red, que es cuando la navegación va a la
// red). Las descargas (OPFS) no se tocan: no viven en Cache Storage.
const VERSION = "onevid-v2";
const SHELL_CACHE = `${VERSION}-shell`;
const STATIC_CACHE = `${VERSION}-static`;
const PAGE_CACHE = `${VERSION}-pages`;
const IMAGE_CACHE = `${VERSION}-images`;

const OFFLINE_URL = "/offline";
const OFFLINE_PLAY_URL = "/offline/play";
const PRECACHE_URLS = [
  OFFLINE_URL,
  OFFLINE_PLAY_URL,
  "/manifest.webmanifest",
  "/onevid-pwa-192.png",
  "/onevid-pwa-512.png",
];
const NAVIGATION_TIMEOUT_MS = 4500;
const MAX_IMAGE_ENTRIES = 160;
// Tope de HTML cacheado: las páginas comparten cuota con las descargas OPFS y
// no tiene sentido quedarse con cientos de navegaciones viejas.
const MAX_PAGE_ENTRIES = 40;

const OFFLINE_FALLBACK_HTML = `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sin conexión • onevid</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; min-height:100dvh; display:grid; place-items:center;
    background:#000; color:#f5f5f5; font:16px/1.5 system-ui, sans-serif; }
  main { max-width:22rem; padding:2rem; text-align:center; }
  h1 { font-size:1.1rem; margin:0 0 .5rem; }
  p { color:#a3a3a3; margin:0 0 1.5rem; }
  a { display:inline-block; padding:.55rem 1rem; border-radius:.5rem;
    background:#f5f5f5; color:#000; font-weight:600; text-decoration:none; }
</style></head>
<body><main>
  <h1>Sin conexión</h1>
  <p>No pudimos abrir esta página porque no hay internet y no está guardada en este dispositivo.</p>
  <a href="/home" data-glimm-skip>Volver al inicio</a>
</main></body></html>`;

function isCacheable(response) {
  return Boolean(response) && (response.ok || response.type === "opaque");
}

function navigationFallback() {
  return new Response(OFFLINE_FALLBACK_HTML, {
    headers: { "content-type": "text/html; charset=utf-8" },
    status: 200,
  });
}

async function fetchWithTimeout(request, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(request, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Extrae los `/_next/...` referenciados por una página para precachearlos. */
function pageAssets(html) {
  const urls = new Set();
  const matcher = /(?:src|href)="(\/[^"]+)"/g;
  let match = matcher.exec(html);
  while (match) {
    const value = match[1];
    if (
      value.startsWith("/_next/") ||
      value.startsWith("/onevid-pwa-") ||
      value.startsWith("/avatar/")
    ) {
      urls.add(value);
    }
    match = matcher.exec(html);
  }
  return [...urls].slice(0, 120);
}

async function precacheOfflinePages(cache) {
  for (const url of [OFFLINE_URL, OFFLINE_PLAY_URL]) {
    try {
      const response = await fetch(url, { cache: "reload" });
      if (!response.ok) {
        continue;
      }
      const html = await response.clone().text();
      await cache.put(url, response);
      const assets = pageAssets(html);
      await Promise.all(
        assets.map((asset) =>
          cache.add(asset).catch(() => {
            /* un chunk con hash viejo no debe romper la instalación */
          })
        )
      );
    } catch {
      /* sin red en el install: la navegación online lo cacheará luego */
    }
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const shell = await caches.open(SHELL_CACHE);
      await Promise.all(
        PRECACHE_URLS.map((url) =>
          shell.add(new Request(url, { cache: "reload" })).catch(() => {})
        )
      );
      await precacheOfflinePages(shell);
      // Sin `skipWaiting()`: la versión nueva queda esperando y la app avisa
      // "Nueva actualización disponible" (service-worker-registrar.tsx). Así
      // nadie queda con el bundle viejo cacheado sin enterarse.
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => !key.startsWith(VERSION))
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") {
    void self.skipWaiting();
  }
});

async function trimCache(cache, maxEntries) {
  try {
    const keys = await cache.keys();
    if (keys.length <= maxEntries) {
      return;
    }
    const excess = keys.length - maxEntries;
    await Promise.all(keys.slice(0, excess).map((key) => cache.delete(key)));
  } catch {
    /* la cuota se gestiona sola */
  }
}

async function cacheFirst(cacheName, request) {
  const cache = await caches.open(cacheName);
  // `caches.match` busca en TODAS las caches: los assets que el install guardó
  // junto al HTML de /offline viven en SHELL_CACHE y deben servirse igual.
  const cached = (await cache.match(request)) || (await caches.match(request));
  if (cached) {
    // Revalidación en segundo plano: la respuesta cacheada se sirve al
    // instante y la siguiente visita usa la versión nueva.
    fetch(request)
      .then((response) => {
        if (isCacheable(response)) {
          return cache.put(request, response.clone());
        }
        return undefined;
      })
      .catch(() => {
        /* offline: se queda la copia actual */
      });
    return cached;
  }

  try {
    const response = await fetch(request);
    if (isCacheable(response)) {
      await cache.put(request, response.clone());
      if (cacheName === IMAGE_CACHE || cacheName === PAGE_CACHE) {
        void trimCache(
          cache,
          cacheName === IMAGE_CACHE ? MAX_IMAGE_ENTRIES : MAX_PAGE_ENTRIES
        );
      }
    }
    return response;
  } catch {
    return cached || Response.error();
  }
}

async function handleNavigation(request) {
  const pageCache = await caches.open(PAGE_CACHE);
  try {
    const response = await fetchWithTimeout(request, NAVIGATION_TIMEOUT_MS);
    if (response.ok) {
      await pageCache.put(request, response.clone()).catch(() => {});
      void trimCache(pageCache, MAX_PAGE_ENTRIES);
    }
    return response;
  } catch {
    /* la red falló o tardó: se sirve la copia local */
  }

  const exact = await pageCache.match(request);
  if (exact) {
    return exact;
  }
  // ignoreSearch permite servir /offline/play precacheado con cualquier ?key=.
  const anyQuery = await caches.match(request, { ignoreSearch: true });
  if (anyQuery) {
    return anyQuery;
  }
  const offline = await caches.match(OFFLINE_URL, { ignoreSearch: true });
  return offline || navigationFallback();
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);

  // Video con Range: el navegador pide trozos y cachearlos rompería el seek.
  if (request.headers.has("range")) {
    return;
  }
  if (
    url.origin === self.location.origin &&
    (url.pathname.startsWith("/api/") ||
      url.pathname.startsWith("/ingest/") ||
      url.pathname.startsWith("/_next/image"))
  ) {
    return;
  }

  if (request.mode === "navigate" || request.destination === "document") {
    event.respondWith(handleNavigation(request));
    return;
  }

  if (url.origin !== self.location.origin) {
    if (request.destination === "image") {
      event.respondWith(cacheFirst(IMAGE_CACHE, request));
    }
    return;
  }

  if (
    url.pathname.startsWith("/_next/static/") ||
    request.destination === "script" ||
    request.destination === "style" ||
    request.destination === "font" ||
    request.destination === "image" ||
    request.destination === "worker"
  ) {
    event.respondWith(cacheFirst(STATIC_CACHE, request));
  }
});
