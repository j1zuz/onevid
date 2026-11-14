# Proveedores debrid

OneVid puede resolver magnets con **TorBox** o **Real-Debrid**. El usuario
configura una o las dos keys en **Configuración → Catálogo** (paso 3 del
stepper) y elige cuál resuelve los magnets; la otra queda guardada para poder
alternar sin volver a pegar el token.

## Qué hace cada proveedor

| | TorBox | Real-Debrid |
|---|---|---|
| Key | `https://torbox.app/settings` | `https://real-debrid.com/apitoken` |
| Endpoint interno | `/api/torbox/resolve` | `/api/real-debrid/resolve` |
| Resolución | `createtorrent` → `mylist` → `requestdl` | `addMagnet` → `selectFiles` → `torrents/info` → `unrestrict/link` |
| Code | `src/lib/torbox.ts` | `src/lib/real-debrid.ts` |

Ambos devuelven la misma forma (`DebridStreamResult` en `src/lib/debrid.ts`):
`ready` con URL, `preparing` con progreso (el cliente reintenta) o
`unavailable`.

Las keys se guardan **cifradas** con AES-256-GCM (`src/lib/secret-box.ts`), nunca
en claro. La de Real-Debrid se valida contra `GET /user` al guardarla y exige
cuenta Premium.

## Addons que ya llevan su propia key

Un addon debrid puede resolver los magnets por su cuenta (por ejemplo, un
addon de TorBox/Real-Debrid configurado con la key del usuario o del operador
del addon). Ese addon devuelve **links HTTP directos**, no magnets: OneVid los
usa tal cual y **no necesita key propia**.

La key en OneVid solo se usa cuando la URL que entrega el addon empieza por
`magnet:` (`rewriteMagnetUrl` en `/api/stream/sources`). Sirve para:

- resolver magnets de addons que **no** traen debrid propio (catálogos de
  torrents);
- usar tu propia cuenta/cuota en vez de la del operador del addon;
- no depender de que el addon tenga su key configurada o siga online.

Por eso el paso 3 es opcional: si todos tus addons ya entregan links directos,
déjalo vacío.

## Proveedor activo

`one_vid.debrid_provider` guarda `torbox` o `realdebrid`. Si es `NULL` o apunta
a un proveedor sin key, `resolveActiveDebridProvider` cae al que sí tenga key
(TorBox primero, por compatibilidad con cuentas previas).

`/api/stream/sources` reescribe los magnets (`magnet:?...`) al endpoint del
proveedor activo, así que web y app usan el mismo. El buscador de magnets
(`/home/player/magnet`) también consulta el proveedor activo.

## Migración

Las columnas se añaden con:

```bash
bun --filter web db:debrid
```

SQL: `apps/web/drizzle/debrid-providers.sql`.
