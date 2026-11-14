# Hardening aplicado (auditoría run-1)

Este documento resume los cambios hechos tras la auditoría source-only y lo que
queda pendiente. No sustituye a la rotación de credenciales.

## Corregido en código

### PIN de perfil con enforcement server-side

- Nuevo `apps/web/src/lib/profile-token.ts`: token HMAC-SHA256 ligado a
  `(userId, profileId, exp)` con dominio propio (`onevid:profile-token:v1`).
- `POST /api/onevid-profiles/[id]/verify` emite el token en una cookie
  `HttpOnly`, `SameSite=Lax`, 30 días, y también lo devuelve en el body para
  las apps nativas.
- `resolveActiveProfile` ahora lee `pinHash`; si el perfil tiene PIN exige un
  token válido. Las rutas de progreso/favoritos/watchlist/saved-status
  devuelven `403 pin_required` sin token. La cookie unsigned
  `onevid-verified-profile` ya no autoriza nada; es solo estado de UI.
- Mobile guarda el token en SecureStore y manda `X-Profile-Token` en
  `apiFetch`.
- Watch-party join usa el token, no la cookie de UI, para aceptar un perfil
  bloqueado.

### Póster de watch-room y resolve de debrid

- `safeImageUrl` solo acepta `https:` o assets locales conocidos
  (`/avatar/`, `/onevid-pwa-`, `/opengraph.jpg`, `/pattern-tile.svg`,
  `/google.svg`). Ya no acepta `/api/...`.
- `/api/torbox/resolve` y `/api/real-debrid/resolve` rechazan
  `Sec-Fetch-Dest` distinto de `video`, `audio` o `empty` (y ausente para apps
  nativas). Una carga same-origin como `<img>`/CSS (`image`) o navegación
  (`document`) ya no puede crear un torrent.

### DSN fuera del artefacto de build

- `apps/web/cloudflare.config.ts` ya no lee `DATABASE_URL` al construir. La
  conexión local de Hyperdrive usa `CF_HYPERDRIVE_DEV_URL` (opcional).
- Se borró el `.cloudflare/output` local que contenía el DSN anterior.
- El fallback Node (`worker/index.ts`/`db.ts`) sigue usando `DATABASE_URL`,
  pero no se serializa en la configuración del Worker.

### Badge móvil / WAF Skip (aplicado en la zona)

- Se eliminó el `User-Agent` con `onevid-app` y el header `X-Onevid-Client` de
  la app. Eran valores públicos: cualquiera podía copiarlos y la regla WAF Skip
  basada en ellos no verificaba nada.
- La regla `Bypass onevid app` de la zona `hackw.tech` ya no matchea por header
  ni por UA. Ahora es un skip **acotado al host**:
  `http.host eq "onevid.hackw.tech" and not path eq "/api/auth/sign-in/magic-link"`
  (fases `http_request_firewall_managed` y `http_request_sbfm`). El skip existe
  porque Super Bot Fight Mode tiene `definitely automated = managed_challenge` y
  los clientes nativos no resuelven challenges JS; la autenticación real sigue
  siendo el Bearer de Better Auth en el origen. Magic-link queda **fuera** del
  skip y pasa por WAF/rate limit.
- Un skip real de "esto es la app" exige **Cloudflare Access (service token)**,
  **mTLS**, **Turnstile** o **Play Integrity/App Attest**; un UA/header no.

### Magic-link

- Además del límite por IP (20/h) y por email hasheado (3/h), hay un **tope
  global de 500/hora** en la ruta de auth de onevid. No toca hackw: es un
  contador de esta app en `rate_limit_bucket`.
- Borde (zona `hackw.tech`, ruleset de rate limiting): `/api/auth/sign-in/magic-link`
  de `onevid.hackw.tech` a **10 req/60 s por IP+colo** con `managed_challenge`
  y 60 s de mitigación. Device-code (`/api/auth/device/*`) a 120/min y perfiles
  (`/api/onevid-profiles/*`) a 120/min. Turnstile sigue disponible como control
  adicional si aparece abuso distribuido.

### Rate limiting

- Better Auth se configura con `rateLimit.enabled: true`, así no depende de
  que `NODE_ENV` esté presente en el Worker.
- Nuevo limitador **distribuido** `apps/web/src/lib/rate-limit-db.ts`: ventana
  fija en la tabla `rate_limit_bucket` (Postgres/Hyperdrive), compartida por
  todos los isolates. Cae al limitador en memoria si la tabla no existe.
- Aplicado a auth (magic-link por IP y por email hasheado, device-code),
  perfiles, debrid, addons, stream y metadata. Límites: PIN verify 10/min,
  perfiles 20/min, reset request 3/h, confirm 10/min, metadata 60/min,
  watch-providers/feed 30/min.
- Migración: `bun --filter web db:rate-limit`.

### Lockout de PIN persistente

- `onevid_profile` gana `pin_failed_attempts` y `pin_locked_until`.
- 5 fallos bloquean el perfil 15 minutos, tanto en `/verify` como en la
  gestión con PIN maestro. Se resetea al acertar.
- Migración: `bun --filter web db:profile-lockout`.
- El token de perfil incluye un fingerprint del `pinHash`: cambiar el PIN
  invalida los tokens anteriores.

### Cifrado de credenciales debrid v2

- `secret-box.ts` escribe `v2:` con HKDF-SHA256 sobre `ONEVID_SECRET_KEY` y
  `info = onevid:debrid-key:v2`. Ya no usa `BETTER_AUTH_SECRET` para escribir;
  si falta el secreto dedicado, la escritura falla cerrada.
- Las filas `v1:` y en claro se siguen **leyendo** para no romper cuentas
  existentes; se migran solas al volver a guardar la key.

### Modo infantil (`isKids`)

- El servidor resuelve el perfil activo (header móvil o cookie web, con fallback
  al perfil primario) y aplica una allowlist de géneros TMDB:
  `Animation` (16), `Family` (10751) y `Kids` (10762).
- Se filtra feed, hero, catálogo, búsqueda, `movie-meta`/`series-meta`, detalle
  y player. En un perfil infantil se ocultan filas de addons y Live TV, y los
  IDs nativos de addon se rechazan en detalle/player y en `/api/stream/*`.
- `MediaMeta`/`SeriesMetaResponse` ahora llevan `genreIds` para que el filtro
  no dependa de nombres de género localizados.

### Cliente y hardening adicional

- **Deep link móvil:** `onevid://player` solo acepta `http(s)` externos; `/api/*`,
  `file://` y `content://` solo cuando la navegación interna trae `from=app`.
  Un link externo ya no puede ejecutar el resolve de debrid con el Bearer.
- **Caché de sesión web:** `AuthCacheGuard` limpia la caché de páginas y el
  hand-off de `sessionStorage` al aparecer/cambiar una sesión, no solo al hacer
  logout.
- **Addons:** la hidratación de un catálogo de addon se limita a `itemsPerRow`
  (antes hidrataba 20 para pintar 4).
- **Watch providers:** `title` limitado a 200 y `id` a 32 caracteres.
- **Subtitle URLs:** solo `http(s)` llegan a `<track src>`.
- **`safeFetch`:** al cambiar de origen en un redirect se eliminan
  `Authorization`, `Cookie` y `Proxy-Authorization`.
- **Feed:** `addonId`, `addonCatalogId`, `liveSourceId` y `liveGroup` limitados a
  200 caracteres.
- **Android:** `allowBackup=false`.



### Repositorio

- `.gitignore` (raíz y mobile) ahora cubre `.env`, `.env.*`, `!.env.example` y
  `.dev.vars`.

## Acción obligatoria del owner (no automatizable)

1. **Rotar** todos los valores de `apps/web/.env` que estaban en los commits
   locales `15202c5`/`5b4dabd`: `DATABASE_URL`, `BETTER_AUTH_SECRET`,
   `TMDB_APP_READ_TOKEN`, `RESEND_API_KEY`, `GOOGLE_CLIENT_SECRET`, y cualquier
   otro del archivo.
2. **Purgar** el blob de `apps/web/.env` de todos los refs (incluidos
   `refs/agents/*` y la rama de sesión archivada), expire reflogs y GC. No
   publiques esos refs. Ejemplo:
   ```bash
   git filter-repo --path apps/web/.env --invert-paths
   git for-each-ref --format='%(refname)' | grep '^refs/agents/' # revisar
   git reflog expire --expire=now --all && git gc --prune=now --aggressive
   ```
3. Verificar que `git check-ignore apps/web/.env` devuelve la ruta.

## Correo transaccional

- Único proveedor: **Cloudflare Email Sending** (binding `EMAIL`, dominio
  `hackw.tech` onboarded). Ya no hay fallback a Resend: se quitó la dependencia,
  el secreto `RESEND_API_KEY` del Worker y la variable del entorno local.
- Remitente: `EMAIL_FROM` (se acepta `RESEND_FROM` mientras un despliegue
  anterior siga sirviendo el binding viejo).
- Sin binding (solo `next dev`) el magic link y el código de reseteo de PIN se
  escriben en consola; en producción la falta de binding es un error explícito.

## Historial de git

- El `.env` que quedó en los checkpoints (`15202c5`, `5b4dabd`) se purgó el
  2026-11-14: se reescribieron **solo** los 2 refs que lo contenían
  (`refs/agents/ac4f41cf…/turn/2` y `agents/nextjs-navigation-black-screen-fix`),
  con el árbol idéntico salvo `apps/web/.env`; después `reflog expire --all` y
  `gc --prune=now`. `main` y `dev` no se tocaron y no hubo force-push.
- Los valores **no se rotaron** (decisión del owner). Siguen vigentes; rotarlos
  en el próximo deploy, o antes si el repo se copia/empuja con esos refs, si
  `.git` va a un backup en nube, o si la máquina se comparte/vende/repara.

## Pendiente

- **Rotación diferida (owner):** `BETTER_AUTH_SECRET`, `ONEVID_SECRET_KEY`,
  `DATABASE_URL`, `TMDB_APP_READ_TOKEN`, `GOOGLE_CLIENT_SECRET`. Hacerla en una ventana de deploy: cierra sesiones e
  invalida las API keys de debrid guardadas.
- **Deploy + migraciones en producción** (`db:debrid`, `db:rate-limit`,
  `db:profile-lockout`). El Worker desplegado es anterior a estos cambios.
- **Zona Cloudflare:** decidir `min_tls_version` (hoy 1.0) y HSTS (deshabilitado);
  afectan a todos los hosts de `hackw.tech`.
- Turnstile opcional para magic-link si aparece abuso distribuido (el borde ya
  corta a 10 req/60 s por IP+colo).
- Permisos del canal `team` de Stream para que solo el host emita
  `watch_sync`/`watch_host`/`watch_end`/`watch_kick`, y probar transferencia de
  host/kick/rejoin.
- Política de egress de Workers para rangos privados/metadata, o DNS pinning
  en un runtime Node. El bypass de punto final ya está corregido.
- `isKids` es una allowlist por género TMDB; ampliarla (certificaciones,
  addons permitidos) si se quiere más catálogo infantil.
- `usesCleartextTraffic` Android por host y firma de `expo-updates`.
- Revocación por dispositivo del token de perfil (hoy es bearer de 30 días;
  cambiar el PIN lo invalida).
- Fase 5 de la auditoría: re-verificación independiente de los leads
  `needs_validation` con entorno local/sandbox.

