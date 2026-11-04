# Live TV backend

Per-account Live TV sources, independent of addons and profiles: extended M3U playlists, Xtream Codes live channels, and channel-bound EPG. All source, redirect, playback, artwork and guide URLs must use HTTPS. Application labels/default names, source filenames, TypeScript symbols and API routes use **Live TV** (`live-tv` / `LiveTv`). Imports and browser callers use `/api/onevid-live-tv`; old API route aliases are not retained. The deployed database table, indexes and constraints have also been renamed to use `live_tv`, preserving existing records.

## Database and dependency

The database migration has been applied and the actual `one_vid_live_tv_source` table, including `source_type` and `epg_url`, has been verified. The deployment SQL script has been removed; no startup migration or SQL script is required. `oneVidLiveTvSource` in `apps/web/src/lib/auth-schema.ts` maps the deployed table with:

- Existing fields: `id`, `user_id`, `url`, `name`, `channel_count`, `created_at`, `updated_at`.
- Source configuration columns: `source_type text NOT NULL DEFAULT 'm3u'`, and nullable `epg_url text`.
- Existing user foreign key/cascade and unique `(user_id, url)` index are unchanged. Existing records default to M3U.

For Xtream, `url` privately stores the canonical HTTPS `player_api.php?username=...&password=...` endpoint; no other credential columns are needed. EPG URLs may also contain secrets. Protect database access/backups and do not log POST bodies, persisted URLs, channel responses or guide URLs.

XMLTV uses the real XML parser **`@xmldom/xmldom` 0.9.10**, installed as a direct `apps/web` dependency.

## Shared contract

Exported from `apps/web/src/lib/live-tv.ts`:

```ts
interface LiveTvSourceSummary {
  id: string;
  name: string;
  channelCount: number;
  type: "m3u" | "xtream";
  hasEpg: boolean;
}
interface LiveTvChannel {
  id: string;
  name: string;
  url: string;
  logo?: string;
  group: string;
  tvgId?: string;
}
interface LiveTvProgramme {
  id: string;
  title: string;
  description?: string;
  start: string; // ISO UTC
  end: string; // ISO UTC
}
interface LiveTvGuideRequest {
  sourceId: string;
  channelIds: string[];
  start: string; // ISO with explicit timezone
  end: string; // ISO with explicit timezone
}
interface LiveTvGuideRow {
  channelId: string;
  programmes: LiveTvProgramme[];
  error?: boolean;
}
interface LiveTvGuideResponse {
  channels: LiveTvGuideRow[];
}
```

Also exported: `parseLiveTvPlaylist`, `normalizeLiveTvUrl`, `LiveTvError`, `LIVE_TV_MAX_CHANNELS` (5000), `LIVE_TV_MAX_PLAYLIST_BYTES` (1 MiB), `LIVE_TV_MAX_SOURCES` (10), `LIVE_TV_MAX_PROGRAMMES` (20), and `LIVE_TV_MAX_XMLTV_BYTES` (8 MiB). Batch exports also include `parseLiveTvGuideRequest`, numeric-epoch `LiveTvGuideWindow`, `LIVE_TV_MAX_GUIDE_CHANNELS` (12), and `LIVE_TV_MAX_GUIDE_WINDOW_MS` (6 hours). This shared module has no server dependencies. Summaries never contain source URLs, EPG URLs, server URLs or credentials. `hasEpg` is true for any explicit XMLTV URL or for Xtream automatic EPG; it advertises capability, not guaranteed schedule availability.

Server implementation exports from `live-tv-server.ts`: `fetchLiveTvResource`, `fetchLiveTvPlaylist`, `fetchXtreamChannels`, `summarizeLiveTvSource`, `listLiveTvSources`, `createLiveTvSource`, `updateLiveTvSourceEpg`, `deleteLiveTvSource`, `loadLiveTvChannels`, `loadLiveTvEpg`, `loadLiveTvGuide`, `validateLiveTvSourceId`, `readLiveTvJson`, and `liveTvApi`. The schema export is `oneVidLiveTvSource`. No old TypeScript symbol aliases remain.

### API

All routes use the existing `auth.api.getSession({ headers: await headers() })`, Node.js runtime, and `Cache-Control: private, no-store`. No separate auth mechanism or media proxy is introduced.

| Method | Route                                                | Request                                       | Success (200)                        |
| ------ | ---------------------------------------------------- | --------------------------------------------- | ------------------------------------ |
| GET    | `/api/onevid-live-tv`                                | —                                             | `{ sources: LiveTvSourceSummary[] }` |
| POST   | `/api/onevid-live-tv`                                | One of the payloads below                     | `{ source: LiveTvSourceSummary }`    |
| PATCH  | `/api/onevid-live-tv`                                | JSON `{ id: string, epgUrl: string \| null }` | `{ source: LiveTvSourceSummary }`    |
| DELETE | `/api/onevid-live-tv`                                | JSON `{ id: string }`                         | `{ ok: true }`                       |
| GET    | `/api/onevid-live-tv/channels?sourceId=...`          | —                                             | `{ channels: LiveTvChannel[] }`      |
| GET    | `/api/onevid-live-tv/epg?sourceId=...&channelId=...` | —                                             | `{ programmes: LiveTvProgramme[] }`  |

`POST /api/onevid-live-tv/guide` accepts `LiveTvGuideRequest` and returns `LiveTvGuideResponse` (details below).

```ts
// M3U: type may be omitted for backward compatibility.
{ type?: "m3u", url: string, name?: string, epgUrl?: string }
// Xtream: serverUrl is the configured HTTPS server, optionally with a base path.
{ type: "xtream", serverUrl: string, username: string, password: string,
  name?: string, epgUrl?: string }
```

Errors are sanitized Spanish `{ error: string }`: `401` without a session, `404` for missing/unowned sources or a channel not belonging to that source, `400` for invalid input/provider data, unsupported/failed sources, duplicates or limits, and generic `500` for unexpected failures. User-facing generated labels/errors never use the old product name.

Names are trimmed/nonempty, max 120 characters; default is `Live TV`. Bodies are limited to 16 KiB. Canonical source URLs are capped at 2048 bytes for the PostgreSQL index; EPG URLs at 2048 characters. Both reject HTTP and URL userinfo. Query secrets are preserved, fragments removed. Credentials are nonempty, max 256 characters each, without controls or dot-only path segments. Xtream server input cannot include arbitrary query parameters.

POST validates the source before insertion. The 10-source limit and canonical-URL duplicate checks are repeated under a user-row lock inside the insert transaction to handle concurrent creation. No network I/O occurs inside that transaction. Different aliases/query order for the same M3U provider are not considered duplicates. Xtream input generates a canonical credential query order.

PATCH configures or replaces an existing source's XMLTV URL without recreating the source. It requires `{ id, epgUrl }`; `epgUrl` must be an HTTPS URL or explicit `null` (omitting it is an error). Ownership is checked before any DNS validation and again in the update. Saving a URL canonicalizes it, caps it at 2048 characters, rejects userinfo/insecure schemes, and validates public target DNS with a 10-second deadline. No guide or playlist download occurs during PATCH. Invalid or failed validation leaves the existing configuration unchanged. The actual guide fetch is separately resolved/validated/pinned and parsed when EPG loads, so a saved DNS result is never trusted for a later connection. Clearing with `null` performs no DNS/network access: M3U then has no EPG, while Xtream resumes automatic EPG and retains `hasEpg: true`. PATCH updates `updatedAt` and returns only the public source summary, never the old or new EPG URL. Missing/unowned sources, including deletion during validation, return 404.

Channel GET refreshes the source on every call, verifies ownership, and updates `channelCount`/`updatedAt` after success. Failed refreshes leave the previous count/source intact. Listing sources returns last successful counts without downloading providers; DELETE does not contact providers. Previously saved HTTP sources cannot refresh and must be replaced with HTTPS sources.

## M3U support

- Extended M3U only (`#EXTM3U` and `#EXTINF`). Handles BOM, CRLF/LF/CR, quoted commas and attributes, `tvg-name`, `tvg-logo`, `tvg-id`, `group-title`, and entry-local `EXTGRP`.
- Display title wins over `tvg-name`; missing names use `Live TV`, missing groups `Sin grupo`. `group-title` wins over `EXTGRP`.
- Relative playback/artwork resolve against the final HTTPS redirect destination. HTTP or invalid channels are skipped; HTTP or invalid logos omitted. No valid channels is an error.
- Canonical stream-URL deduplication keeps the first entry. IDs now use the `live-tv-` prefix and stable URL-based hashes, independent of playlist ordering, but change when a stream URL/token changes. Retains at most 5000 channels.
- Rejects direct HLS master/media manifests (`EXT-X-*`), DRM and player-specific custom header directives (`EXTVLCOPT`, `EXTHTTP`, `KODIPROP`, `EXTDRM`, `DRM`). Pipe-style stream headers are unsupported. The backend does not inspect remote media DRM.

## Xtream Codes

Auth is fetched from the configured `player_api.php` endpoint. `user_info.auth` must be enabled, status Active, and any supplied expiration must be valid and in the future. Null/absent/empty expiration indicates no declared expiry. Auth is checked again for channel/EPG refreshes. Server info/returned media hosts are never trusted for connection/playback construction.

Live streams and categories come from `action=get_live_streams` and `action=get_live_categories`. Both JSON responses are bounded at 8 MiB; scans are capped at 50000 stream records and 5000 category records, and at most 5000 unique numeric stream IDs are returned. Categories provide group names. IDs are `xtream-<stream_id>` and remain stable across refreshes/reordering. Provider artwork must be HTTPS.

Playback uses the configured HTTPS origin and preserved base path:
`<server-base>/live/<encoded-username>/<encoded-password>/<stream_id>.m3u8`.
Provider `direct_source`, stream URL or server host fields cannot redirect playback to another origin or HTTP. Playback URLs necessarily contain credentials; keep responses private and avoid logs/APM body capture.

## EPG

EPG first verifies source ownership, reloads channels server-side and verifies the requested `channelId` belongs to that source. Clients cannot select arbitrary XMLTV channel identifiers or arbitrary Xtream stream IDs. Missing membership returns 404 before any guide call.

- M3U uses optional `epgUrl` and the bound channel's `tvgId` (`tvg-id`). No configured URL or no mapped `tvgId` returns `[]`.
- Xtream automatically requests `get_short_epg&stream_id=<bound-id>&limit=20`. An explicit `epgUrl` overrides automatic EPG and uses the same XMLTV/tvgId mapping. If the override has no matching channel mapping, it returns `[]` instead of falling back to automatic EPG.
- Only current/upcoming entries (`end > now`, `end > start`) are returned, sorted by start, deduplicated by channel/start, max 20. Titles/descriptions are bounded, with unsafe control characters removed; absent titles use `Live TV`. IDs are deterministic hashes of bound channel/start.
- Xtream base64 title/description is validated, decoded as strict UTF-8, and sanitized. Invalid encoding does not leak raw provider data; text falls back/omits. Unix-second start/stop timestamps take priority. Textual fallback accepts explicit-offset ISO or XMLTV timestamps; ambiguous local-only dates are omitted rather than guessing the provider/server timezone. At most 1000 returned guide records are inspected.
- XMLTV is fetched with an 8 MiB bound. `@xmldom/xmldom` parses XML structure, entities and CDATA; there is no regex-based programme extraction. DTD/entity declarations, unknown entities, malformed XML and forbidden controls are rejected. Predefined XML entities such as `&amp;` are supported. Parser error handlers throw sanitized errors without logging untrusted XML. Conservative token, node and depth bounds limit DOM work. XMLTV dates validate calendars and numeric UTC offsets; an absent timezone means UTC per XMLTV convention. Only exact server-selected channel IDs match.

## Batch grid guide

`POST /api/onevid-live-tv/guide` supports the channel-row/time-column grid without changing the single-channel endpoint:

```ts
// Request (UI can use 10 rows and a 3-hour window):
{
  sourceId: string,
  channelIds: string[], // 1–12 unique source channel IDs, in desired row order
  start: string,       // valid ISO timestamp with explicit Z or numeric offset
  end: string          // end > start; duration <= 6 hours
}
// Response:
{
  channels: Array<{
    channelId: string,
    programmes: LiveTvProgramme[], // max 20, sorted, real data only
    error?: boolean               // only true for an isolated guide failure
  }>
}
```

The response preserves requested row order and normalizes programme timestamps to ISO UTC. The request validator trims identifiers, rejects duplicates (including duplicates after trimming), requires 1–12 rows and valid calendar/timezone values, and normalizes window timestamps. Invalid requests return 400 before provider access. The normal API wrapper authenticates before parsing request bodies. Ownership is verified in a single database query before any provider calls. Source auth/catalog/categories are loaded **once per batch**, not per row, and every requested ID is checked against that catalog. Any unowned/missing source or nonmember channel rejects the entire request with 404 before guide calls; source-wide auth/catalog failures remain sanitized request errors.

For a configured XMLTV override, the guide is downloaded **once** and `parseXmltvChannels` parses **one bounded DOM**, then routes programme entries to all requested `tvgId` values in one pass. Shared mappings reuse results. Unmapped channels have empty schedules. A shared download/parse failure sets `error: true` only on mapped rows. The same behavior applies to Xtream sources with an XMLTV override; no automatic short-EPG calls occur in that case.

Without an override, Xtream verifies auth once, loads streams/categories once, and issues at most **3 concurrent** `get_short_epg&stream_id=...&limit=20` requests across the selected rows. A row's provider/parse error produces `{ channelId, programmes: [], error: true }` without error details, URLs or credentials; other rows continue normally. Providers may not offer schedules for every requested window, and unavailable programmes remain absent. A source without EPG returns honest empty rows, never fabricated slots.

Batch interval selection is half-open: `programme.start < window.end && programme.end > window.start`. It includes programmes crossing either window edge, excludes entries that end exactly at window start or start exactly at window end, and supports past windows when real provider data exists. Filtering occurs before each row's 20-programme cap. Actual programme start/end timestamps are preserved; the UI clips visual cells to its columns without changing the programme's real schedule. Pure `selectProgrammes` and `parseXtreamEpg` accept an optional numeric `LiveTvGuideWindow`; without that option their existing now/upcoming behavior is unchanged. The single `GET .../epg` endpoint still returns only now/upcoming entries.

## HTTPS transport and privacy

`fetchLiveTvResource` in `live-tv-server.ts` generalizes the internal pinned `node:https.request` transport. It reuses existing `isSafeFetchUrl` and the normal playlist body cap, but does not call `safeFetch` because that wrapper cannot pin DNS. Each resource fetch has a 10-second total deadline across DNS, connection/TLS, redirects and body reads; composite Xtream operations make several individually bounded resource calls. Manual redirects are limited to 3. The default body limit is 1 MiB, with explicit bounded 8 MiB allowances for Xtream JSON/XMLTV. Response headers are capped at 16 KiB. Requests/responses are destroyed on completion, error or timeout. Requests require identity encoding; unexpected compression is rejected.

Each hop resolves DNS once, rejects empty or mixed public/private answers and pins the connector to the first validated public numeric IP. Literal IP URLs are validated directly. The custom lookup never re-resolves; even an all-address lookup returns only that pinned IP. Fresh connections (`agent: false`), explicit family selection and normal TLS Host/SNI/certificate verification prevent unvalidated resolution, shared-socket reuse or loss of hostname verification. `rejectUnauthorized: true` is explicit. Every redirect, including same-host redirects, is validated and pinned anew. No fallback to unvalidated addresses, caller agent, proxy or arbitrary headers is allowed. Production network egress restrictions remain recommended as defense in depth.

**Xtream requests reject all cross-origin redirects**, even if a redirect drops credentials. The same restriction applies to other resource URLs with `username`/`password` query parameters. HTTPS downgrades and URL userinfo are always rejected. No incoming credentials/cookies/Authorization are forwarded and provider cookies are not retained. Source/EPG URLs and provider exceptions/bodies are never logged or returned in errors. No provider response caching is used.

Playback/artwork are fetched directly by the browser, not by this backend; those returned URLs are HTTPS-only but are not public-IP filtered. Providers receive the browser's IP. Provider CORS and supported HLS codecs are required. Browser-side media redirects and nested HLS segment/key URLs are not inspected by this backend and must also be securely served by the provider.

## Validation

From `apps/web`:

```sh
bun test src/lib/live-tv.test.ts src/lib/xtream.test.ts src/lib/xmltv.test.ts
```

Fixtures mock HTTPS, DNS and database reads; no live provider credentials, network provider calls or database mutations are needed. Coverage includes existing parser/SSRF/timeout limits plus Xtream auth/categories/playback construction, credential redirect restrictions, summary secrecy, XMLTV entities/DTD/controls/size/nesting, timezone/base64 handling, result caps, batch payload/window validation, half-open overlap filtering and timezone handling, EPG ownership/channel binding, single catalog/XMLTV parsing per batch, max-3 Xtream guide concurrency and row error isolation. Database insert locking/constraints and full session flows still require smoke tests against the migrated staging database.
