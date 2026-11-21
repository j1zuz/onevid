# Soporte sin conexión (PWA)

La web funciona como PWA instalable y puede abrirse sin internet. Dos piezas
independientes:

1. **Descargas OPFS** (ya existentes): el botón de descarga del reproductor
   guarda la película/episodio en el almacenamiento privado del navegador. Vive
   en `src/hooks/use-mediabunny.ts` y se administra desde **Configuración →
   Descargas sin conexión**.
2. **Service worker** (`public/sw.js`): cachea el shell de la app y las páginas
   visitadas para que la PWA abra aunque no haya red.

## Qué cachea el service worker

| Recurso | Estrategia |
|---|---|
| Navegaciones (`request.mode === "navigate"`) | network-first con timeout de 4,5 s → copia cacheada → `/offline` |
| `/_next/static/*`, scripts, estilos, fuentes, imágenes | cache-first con revalidación en segundo plano |
| Imágenes remotas (pósters TMDB) | cache-first, tope de 160 entradas |
| `/api/*`, `/ingest/*`, `_next/image`, respuestas con `Range` | **nunca** se cachean |

En el `install` precachea `/offline` y `/offline/play`, incluyendo los chunks de
JS/CSS que referencian, para que la biblioteca local abra desde el primer
momento sin red.

## Páginas offline

- `/offline`: lista las descargas de OPFS con título, póster, tamaño y
  vencimiento. No hace ninguna petición al servidor.
- `/offline/play?key=...`: reproduce el archivo guardado con un blob URL. No usa
  el player del catálogo (ese necesita red para pedir fuentes). Retoma donde se
  quedó el usuario y guarda la posición en `localStorage`
  (`src/lib/watch-progress-local.ts`): sin red no se puede preguntar al
  servidor. El reproductor del catálogo deja ahí un espejo de cada checkpoint,
  y esta página lo usa al abrir la descarga.

Los enlaces de estas páginas llevan `data-glimm-skip` para forzar navegación
completa: el router de Next no puede pedir el payload RSC sin internet.

## Aviso y registro

- `OfflineIndicator` muestra un aviso flotante con enlace a `/offline` cuando
  `navigator.onLine` pasa a `false`.
- `ServiceWorkerRegistrar` registra `/sw.js` **solo en producción**; en
  `next dev` una caché stale complica más de lo que ayuda.
- Al **cerrar sesión o cambiar de perfil** se borra la caché de páginas
  (`clearPwaPageCache`), para que una navegación offline no sirva el HTML de la
  cuenta/perfil anterior en un dispositivo compartido. Solo se borra
  `*-pages`; el shell de `/offline` y `/offline/play` se conserva.

> **Límite de diseño:** las descargas viven en OPFS y pertenecen al
> **dispositivo**, no a la cuenta. Cualquiera que use este navegador puede abrir
> `/offline` y reproducirlas, incluso sin sesión. Es el precio de que funcionen
> sin red; en equipos compartidos conviene no dejar descargas guardadas.

Para probarlo: `bun run build:vinext && bun run start:vinext`, abrir /home una
vez, guardar una descarga, y cortar la red (DevTools → Network → Offline).
