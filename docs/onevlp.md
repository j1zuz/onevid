# OneVLP v1

Protocolo nativo de addons de OneVid.

Estado: **borrador**. Nada de esto está implementado todavía; este documento es el
contrato a discutir antes de escribir código.

## Por qué existe

El protocolo de Stremio funciona, pero obliga al cliente a **adivinar**:

- la calidad se deduce parseando `name` y `title` con regex (`parseQualityTier`);
- el tipo de stream se deduce con `url.startsWith("magnet:")` (`rewriteMagnetUrl`);
- los metadatos viajan como `string[]` sin estructura (`metadata`);
- `infoHash` se descarta porque no hay campo para él (ver `parseStremioStreams`);
- no hay forma de decir "esto está cacheado" sin escribirlo en el título;
- no hay batch: un episodio por request, sin prefetch;
- la configuración viaja en la URL en base64, así que reconfigurar es reinstalar.

OneVLP existe para que el cliente **no parsee nada**. Cada dato que hoy se adivina
es un campo tipado.

## Principios

1. **Tipado o ausente.** Si un dato no se conoce, se omite o va `null`. Nunca se
   inventa ni se mete en un string.
2. **El cliente no parsea.** Ningún campo de presentación contiene datos
   estructurados. El orden de la UI lo decide el cliente, no el addon.
3. **Degradación explícita.** Un addon que no puede dar un dato lo marca; el
   cliente lo muestra distinto, no lo finge.
4. **Auth por header, nunca en la URL.** Ningún secreto en paths, query strings ni
   logs.
5. **Todo lo desconocido se ignora.** Campos y valores nuevos no rompen clientes
   viejos. Es lo que permite evolucionar sin versiones nuevas.
6. **Unidades explícitas en el nombre.** `sizeBytes`, `durationMs`,
   `bitrateKbps`, `deadlineMs`. Nunca `size` a secas.
7. **Rendimiento como contrato.** Batch, deadline y streaming son parte del
   protocolo, no optimizaciones opcionales.

## Transporte

- HTTPS obligatorio. Sin excepciones, tampoco para `manifest`.
- `Content-Type: application/json` (o `application/x-ndjson` en streaming).
- Rutas versionadas por prefijo: `/v1/...`.
- El addon declara `protocol: "onevlp/1"` en su manifest.

### Endpoints

| Método | Ruta | Auth | Uso |
|---|---|---|---|
| `GET` | `/v1/manifest` | no | Identidad y capacidades |
| `POST` | `/v1/streams` | opcional | Fuentes de reproducción (batch + streaming) |
| `GET` | `/v1/catalog/{type}/{id}` | opcional | Catálogo paginado |
| `POST` | `/v1/subtitles` | opcional | Pistas de subtítulos (batch) |
| `POST` | `/v1/live/channels` | opcional | Canales de Live TV |
| `POST` | `/v1/live/epg` | opcional | Guía de programación |
| `POST` | `/v1/events` | opcional | Telemetría del addon (opt-in) |

Un addon puede implementar solo un subconjunto. El manifest dice cuál.

---

## 1. Manifest

```http
GET /v1/manifest
```

```json
{
  "protocol": "onevlp/1",
  "id": "community.onevid",
  "name": "OneVid Community",
  "version": "1.0.0",
  "description": "Catálogos y fuentes curados por la comunidad",
  "homepage": "https://onevid.hackw.tech",
  "contact": "https://discord.gg/...",
  "auth": {
    "type": "bearer",
    "required": false,
    "configUrl": "https://addon.example.com/configure"
  },
  "capabilities": {
    "streams": {
      "batch": true,
      "maxItems": 10,
      "streaming": "ndjson",
      "deadlineMs": 5000
    },
    "catalogs": {
      "pagination": "cursor",
      "maxPageSize": 100
    },
    "subtitles": true,
    "live": { "channels": true, "epg": true },
    "events": true
  },
  "catalogs": [
    {
      "type": "movie",
      "id": "top-es",
      "name": "Top comunidad (ES)",
      "filters": [
        { "id": "genre", "name": "Género", "options": ["Acción", "Drama"] }
      ]
    }
  ],
  "rateLimit": { "requestsPerMinute": 60 },
  "cache": { "manifestTtlSeconds": 86400 }
}
```

Reglas:

- `id` es estable y único (formato sugerido: `dominio.addon`).
- `version` es semver. Cambiarla invalida la caché del cliente.
- `capabilities` es la fuente de verdad. Si un endpoint no aparece, el cliente no
  lo llama.
- `auth.required: false` significa que el addon funciona sin token; con token da
  más (por ejemplo, `availability` propia).
- `catalogs[].filters` declara los filtros de forma máquina-legible, así que el
  cliente puede construir el selector sin hardcodear nada.

### Respuesta de error del manifest

```json
{ "error": { "code": "MAINTENANCE", "message": "Vuelvo en 10 min", "retryable": true } }
```

---

## 2. Identidad de media

Un solo objeto para todos los endpoints. Nunca un string compuesto.

```json
{
  "type": "series",
  "ids": { "imdb": "tt0944947", "tmdb": "1399", "tvdb": "121361" },
  "season": 1,
  "episode": 5
}
```

- `type`: `movie` | `series` | `live`.
- `ids`: al menos uno. `imdb` es el preferido porque no cambia nunca; `tmdb` y
  `tvdb` permiten al addon evitar una resolución extra.
- `season` y `episode` solo existen si `type` es `series`.
- Sin `season`/`episode` en una serie significa "el título completo" (packs,
  temporada completa).

Esto reemplaza `tt0944947:1:5` y elimina la clase de bugs donde un id con dos
puntos rompe el parseo.

---

## 3. Streams

```http
POST /v1/streams
Authorization: Bearer <token>
Accept: application/x-ndjson
Content-Type: application/json
```

```json
{
  "protocol": "onevlp/1",
  "items": [
    { "type": "series", "ids": { "imdb": "tt0944947" }, "season": 1, "episode": 5 },
    { "type": "series", "ids": { "imdb": "tt0944947" }, "season": 1, "episode": 6 }
  ],
  "prefetch": [
    { "type": "series", "ids": { "imdb": "tt0944947" }, "season": 1, "episode": 7 }
  ],
  "prefs": {
    "maxResolution": "2160",
    "languages": ["es", "en"],
    "exclude": ["cam", "ts", "screener"],
    "prefer": ["cached", "seeded"]
  },
  "deadlineMs": 4000,
  "client": { "name": "onevid-web", "version": "1.0.0", "platform": "web" }
}
```

- `items`: 1..`capabilities.streams.maxItems`. Cada uno recibe su índice.
- `prefetch`: lo que el cliente pedirá después. El addon puede calentarlo sin
  devolverlo.
- `prefs` es una **pista**, no una orden: el addon puede ignorarla y el cliente
  reordena igual. Sirve para ahorrar trabajo, no para delegar la decisión.
- `deadlineMs` es el presupuesto total. Pasado ese tiempo el cliente cierra la
  conexión y usa lo que llegó. Un addon lento nunca bloquea la UI.

### Respuesta: NDJSON

Una línea JSON por evento:

```json
{"type":"stream","item":0,"stream":{ /* Stream */ }}
{"type":"stream","item":0,"stream":{ /* Stream */ }}
{"type":"error","item":1,"error":{"code":"PROVIDER_TIMEOUT","provider":"1337x","retryable":true}}
{"type":"done","stats":{"tookMs":842,"providers":4,"failed":1}}
```

Si el addon no soporta `streaming`, responde un JSON normal:

```json
{ "streams": [ /* Stream[] */ ], "errors": [ /* Error[] */ ], "stats": { "tookMs": 842 } }
```

El primer resultado llega en cuanto existe. No se espera al provider más lento.

### El objeto Stream

```json
{
  "id": "b3f1c2a4",
  "source": {
    "addon": "community.onevid",
    "provider": "elitetorrent",
    "degraded": false
  },
  "playback": {
    "kind": "magnet",
    "uri": "magnet:?xt=urn:btih:DD8255ECDC7CA55FB0BBF81323D87062DB1F6D1C",
    "headers": {},
    "expiresAt": null
  },
  "file": {
    "name": "Dune.Part.Two.2024.2160p.REMUX.mkv",
    "sizeBytes": 61234567890,
    "index": 0,
    "durationMs": 9960000
  },
  "video": {
    "resolution": "2160",
    "width": 3840,
    "height": 2160,
    "codec": "hevc",
    "hdr": "dv",
    "bitrateKbps": 65000,
    "fps": 23.976
  },
  "audio": [
    { "codec": "truehd", "channels": 8, "lang": "en" },
    { "codec": "eac3", "channels": 6, "lang": "es", "dub": true, "default": true }
  ],
  "subtitles": [
    { "lang": "es", "format": "srt", "uri": "https://.../sub.srt", "forced": false }
  ],
  "availability": [
    { "provider": "torbox", "state": "cached", "checkedAt": "2026-11-14T10:00:00Z" }
  ],
  "tags": ["remux", "dv", "es"],
  "score": 0.93,
  "behavior": {
    "bingeGroup": "onevid-es-2160",
    "continueSupported": true
  }
}
```

**Obligatorio:** `id`, `source.addon`, `playback.kind`, `playback.uri`.
Todo lo demás es opcional. Un stream mínimo válido:

```json
{ "id": "x", "source": { "addon": "a.b" }, "playback": { "kind": "magnet", "uri": "magnet:?xt=..." } }
```

#### `playback.kind`

| kind | `uri` | Notas |
|---|---|---|
| `magnet` | `magnet:?xt=urn:btih:...` | El cliente resuelve con el debrid del usuario |
| `http` | `https://...` | Archivo directo, soporta `Range` |
| `hls` | `https://...m3u8` | El cliente usa su reproductor HLS |
| `dash` | `https://...mpd` | Igual, DASH |
| `live` | `https://...` | Continuo, sin duración (`file.durationMs` ausente) |

`kind` elimina el sniffing de esquema. Un `kind` desconocido se descarta sin
error: así se añaden formatos nuevos sin romper clientes viejos.

#### `playback.headers`

Headers que el reproductor debe enviar. Existe porque hay fuentes que exigen
`Referer` o `Cookie`, y en Stremio eso directamente no se puede expresar.

Restricciones: solo headers de la petición de media. El cliente **no** reenvía
cookies del usuario ni `Authorization` a terceros.

#### `availability`

```json
{ "provider": "torbox", "state": "cached", "checkedAt": "..." }
```

| `state` | Significado |
|---|---|
| `cached` | Ya está en el debrid, arranca sin descargar |
| `preparing` | Está en la cuenta pero aún descargando |
| `uncached` | Hay que descargarlo |
| `unknown` | No verificado (es lo que devuelve el adaptador Stremio) |

Es la razón de ser de OneVLP: el cliente puede ordenar `cached` primero sin
adivinar, y mostrar "sin verificar" cuando el addon no lo sabe.

#### `score`

0..1, opcional. Es la recomendación del addon. **El cliente no está obligado a
respetarla**: reordena según las preferencias del usuario. `score` desempata, no
decide.

#### `behavior`

- `bingeGroup`: agrupa releases equivalentes para que "siguiente episodio" use
  la misma. Sin esto la experiencia se siente rota.
- `continueSupported`: el `uri` admite `Range` y se puede reanudar.

### Errores

```json
{ "code": "PROVIDER_TIMEOUT", "message": "1337x no respondió", "provider": "1337x", "retryable": true }
```

| Código | Cuándo |
|---|---|
| `PROVIDER_TIMEOUT` | Una fuente excedió el presupuesto |
| `PROVIDER_ERROR` | La fuente falló (HTTP, parseo) |
| `NOT_FOUND` | No hay resultados, y eso es definitivo |
| `RATE_LIMITED` | El addon se autolimita, con `retryAfterMs` |
| `AUTH_REQUIRED` | Falta token o expiró |
| `DEADLINE_EXCEEDED` | Se acabó el tiempo con resultados parciales |
| `INTERNAL` | Error inesperado |

Regla: un error **nunca** invalida los streams de otros items. Resultados
parciales son válidos y esperados.

---

## 4. Catálogos

```http
GET /v1/catalog/{type}/{id}?cursor=...&limit=...&genre=Acción
```

```json
{
  "items": [
    {
      "id": "tmdb:693134",
      "type": "movie",
      "ids": { "imdb": "tt15239678", "tmdb": "693134" },
      "name": "Dune: Parte Dos",
      "year": 2024,
      "poster": "https://image.tmdb.org/t/p/w500/...",
      "background": "https://image.tmdb.org/t/p/original/...",
      "description": "Paul Atreides se une a los Fremen...",
      "genres": ["Ciencia ficción", "Aventura"],
      "rating": 8.2,
      "runtimeMs": 9960000
    }
  ],
  "nextCursor": "eyJvZmZzZXQiOjIwfQ",
  "total": 240
}
```

- Paginación por cursor, no por `skip`. Stremio finge paginar con `skip` y casi
  ningún addon lo implementa bien.
- `nextCursor: null` significa fin.
- Los `ids` son **obligatorios** para películas y series: sin `imdb` o `tmdb` el
  cliente no puede hidratar metadatos ni pedir streams. Es la causa número uno
  de catálogos rotos en Stremio.
- La imagen es una URL absoluta HTTPS. El cliente no construye rutas.
- Si el addon devuelve `ids`, el cliente puede enriquecer con TMDB y **el addon
  no necesita saber de pósters**. Ventaja concreta de estar integrado.

---

## 5. Subtítulos

```http
POST /v1/subtitles
```

```json
{
  "items": [
    { "type": "movie", "ids": { "imdb": "tt15239678" } }
  ],
  "languages": ["es", "en"]
}
```

```json
{
  "tracks": [
    {
      "item": 0,
      "id": "opensubtitles:123456",
      "lang": "es",
      "format": "srt",
      "uri": "https://.../123456.srt",
      "label": "Español (España)",
      "forced": false,
      "hearingImpaired": false
    }
  ],
  "errors": []
}
```

`format`: `srt` | `vtt` | `ass` | `pgs`. El cliente convierte si puede; si no,
oculta la pista. Nunca rompe la reproducción.

---

## 6. Live TV

Dos endpoints, porque son dos ciclos de vida distintos: los canales apenas
cambian, la guía cambia cada hora.

```http
POST /v1/live/channels     → lista de canales
POST /v1/live/epg          → programación de una ventana
```

```json
{
  "channels": [
    {
      "id": "c1",
      "name": "Canal 1",
      "logo": "https://.../logo.png",
      "group": "Deportes",
      "tvgId": "canal1.es",
      "playback": { "kind": "hls", "uri": "https://.../stream.m3u8" }
    }
  ],
  "nextCursor": null
}
```

```json
{
  "window": { "start": "2026-11-14T00:00:00Z", "end": "2026-11-14T06:00:00Z" },
  "channels": [
    {
      "channelId": "c1",
      "programmes": [
        { "id": "p1", "title": "Partido", "start": "2026-11-14T01:00:00Z", "end": "2026-11-14T03:00:00Z" }
      ]
    }
  ]
}
```

Live TV es donde Stremio va más cojo: no tiene contrato para EPG ni para
ventanas de programación. Aquí partimos con ventaja porque el backend ya existe
(`lib/live-tv.ts`).

---

## 7. Eventos (opt-in)

```http
POST /v1/events
```

```json
{
  "events": [
    { "type": "started", "streamId": "b3f1c2a4", "at": "2026-11-14T10:00:00Z" },
    { "type": "failed", "streamId": "b3f1c2a4", "at": "2026-11-14T10:00:12Z", "reason": "BUFFERING" },
    { "type": "played", "streamId": "b3f1c2a4", "positionMs": 300000, "at": "..." }
  ]
}
```

- Solo si `capabilities.events: true`.
- **Nunca** se envía identidad de usuario, IP ni título visto. El addon recibe un
  `streamId` opaco y nada más.
- Sirve para que un addon sepa qué releases fallan y mejore su ranking, sin
  necesitar cuentas.

---

## 8. Auth

- `Authorization: Bearer <addon-token>`.
- El token lo emite **el addon**, no OneVid. El usuario lo pega una vez en la
  página de configuración del addon y recibe su URL de instalación.
- OneVid guarda el token cifrado junto a la URL del addon y lo envía en cada
  request. Nunca aparece en la URL, ni en logs, ni en el manifest.
- `401` + `AUTH_REQUIRED` = el cliente pide reconfigurar, no reintenta en bucle.
- Un addon sin auth es perfectamente válido (`required: false`). La mayoría no la
  necesita.

Lo que **no** viaja nunca: la clave de TorBox del usuario. OneVid resuelve los
magnets con ella en su propio servidor. Un addon que pida la clave de debrid
está mal diseñado y el cliente debe rechazarlo.

---

## 9. Compatibilidad y evolución

- Campos desconocidos: se ignoran.
- Valores desconocidos en enums (`kind`, `state`, `code`): se descarta el stream o
  el error, no la respuesta entera.
- Campos nuevos: siempre opcionales.
- Campos nuevos con prefijo `x-`: libres, el cliente los ignora pero no falla.
- Retirar algo requiere **una versión mayor nueva** (`/v2`) y convivencia de al
  menos 6 meses.

Todo esto es lo que Stremio no puede hacer: al no tener capacidades ni
tolerancia a lo desconocido, cada cambio es un reinstall.

---

## 10. Niveles de conformidad

Para que "cumple OneVLP" signifique algo y se pueda verificar:

| Nivel | Requiere |
|---|---|
| **L1 — Catálogos** | `manifest` + `/v1/catalog` con paginación |
| **L2 — Streams** | L1 + `/v1/streams` con `playback` tipado |
| **L3 — Extendido** | L2 + batch + `availability` + `behavior` |
| **L4 — Completo** | L3 + subtítulos + Live TV + eventos |

La suite de conformidad hace requests reales y valida contra el JSON Schema. Un
addon sin nivel verificado no aparece en la tienda.

---

## 11. Mapa a OneVid hoy

| OneVLP | Modelo interno actual | Cambio |
|---|---|---|
| `playback.kind` | `url.startsWith("magnet:")` | Campo explícito |
| `video.resolution` | `parseQualityTier()` con regex | Se usa tal cual |
| `availability` | inexistente | Nuevo: orden `cached` primero |
| `source.degraded` | implícito | Se muestra "sin verificar" |
| `audio[]`, `video.codec` | `SourceCompatibility` heurístico | Datos reales del addon |
| `behavior.bingeGroup` | inexistente | Prefetch de siguiente episodio |
| `ids` objeto | string `tt...:1:5` | Sin parseo de strings |
| `POST /v1/streams` | `GET /streams?imdbID=` | Batch + deadline |

El modelo interno (`StreamSource` en `types/stream.ts`) ya es casi esto: el
trabajo es mover los datos de `title`/`behaviors` a campos propios.

---

## 12. Lo que el addon gana (por qué escribir para OneVLP)

El protocolo solo no convence a nadie. Esto sí:

- **Cero claves de debrid.** El addon devuelve magnets; OneVid resuelve con la
  cuenta del usuario. El addon nunca toca un secreto.
- **Metadatos gratis.** Devuelve `imdb` y OneVid hidrata póster, sinopsis y
  reparto con TMDB. No scrapeas imágenes.
- **Badge `cached` gratis.** Con una key propia de TorBox y `checkcached`, todos
  los usuarios ven ⚡ sin configurar nada.
- **Distribución.** Tienda dentro de OneVid (web, Android, Android TV, webOS),
  no un hilo de Reddit con URLs.
- **Hosting.** Plantilla de Worker con deploy en un clic y KV incluido.
- **Tests.** Suite de conformidad y playground que renderiza tu addon antes de
  publicarlo.
- **Sin reinstall.** Cambias `version`, no la URL.
