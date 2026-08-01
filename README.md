# onevid

Monorepo de **onevid**: una app de vídeo con cliente móvil/TV (Expo + React Native) y web
(Next.js), compartiendo componentes de UI.

```
apps/
  mobile/   Expo (React Native tvOS/Android TV + móvil), expo-router
  web/      Next.js 16 + better-auth + drizzle (Postgres)
packages/
  ui/       Componentes compartidos de la web (@workspace/ui)
```

El gestor de paquetes es **Bun** (workspaces + catalog). No uses npm/yarn/pnpm: el lockfile es
`bun.lock` y hay dependencias parcheadas (`patches/`) que solo aplica Bun.

## Requisitos

- **Bun** ≥ 1.3.13
- **Node 20+** (algunas herramientas de Expo/EAS lo necesitan)
- Para compilar Android en local: **JDK 17** y el **Android SDK** con `ANDROID_HOME` exportado
- Para iOS / Apple TV: una **Mac con Xcode** (no se puede compilar en Linux)

## Empezar

```bash
bun install
```

### Web

```bash
bun dev          # next dev  (apps/web)
bun run build    # next build
bun start        # next start
```

Migraciones de base de datos (drizzle, desde `apps/web`):

```bash
bunx drizzle-kit generate
bunx drizzle-kit migrate
```

Previsualizar los emails de React Email:

```bash
bun --filter web email:dev
```

### Móvil / TV

```bash
bun mobile       # expo start (apps/mobile)
```

La app usa módulos nativos propios (`expo-libvlc-player`, `react-native-tvos`), así que **no
funciona en Expo Go**: necesitas un *development build* con `expo-dev-client`. El cambio entre
móvil y TV lo hace el plugin `@react-native-tvos/config-tv` leyendo la variable de entorno
`EXPO_TV` en tiempo de build.

Todos estos scripts se ejecutan desde `apps/mobile` (o con `bun --filter onevid <script>`):

| Objetivo | Móvil | Android TV |
| --- | --- | --- |
| Dev build + instalar (debug, lo más rápido) | `bun android` | `bun android:tv` |
| APK distribuible (sideload) | `bun run build:android` | `bun run build:android:tv` |
| AAB para Play Store | `bun run build:android:prod` | `bun run build:android:tv:prod` |
| Update OTA (sin recompilar) | `bun run update` | `bun run update:tv` |
| Lint | `bun lint` | — |

> ⚠️ `eas build` **sin** `--local` compila en la nube de Expo y **cobra por build**. Todos los
> scripts `build:*` de arriba usan `--local`: compilan en tu máquina y no generan cargos.
> Los perfiles `-tv` de `eas.json` ya inyectan `EXPO_TV=1`.

Los `expo run:*` (`bun android` / `bun android:tv`) son 100% locales y no necesitan `eas-cli`.
Para los scripts `build:*` y `update*` sí hace falta `eas-cli` global (`bun add -g eas-cli`).

## Variables de entorno

`apps/web/.env`:

| Variable | Para qué |
| --- | --- |
| `DATABASE_URL` | Postgres (drizzle + better-auth) |
| `BASE_URL` | URL pública de la web |
| `COOKIE_DOMAIN` | Dominio de las cookies de sesión |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Login con Google |
| `APPLE_CLIENT_ID` / `APPLE_CLIENT_SECRET` | Login con Apple |
| `RESEND_API_KEY` / `RESEND_FROM` | Envío de emails |
| `TMDB_APP_READ_TOKEN` | API de TMDB |
| `NEXT_PUBLIC_POSTHOG_TOKEN` | Analítica |

`apps/mobile/.env`:

| Variable | Para qué |
| --- | --- |
| `EXPO_PUBLIC_API_URL` | URL de la API (la app web) |
| `EXPO_PUBLIC_HACKW_CLIENT_ID` | Client ID de auth |
| `EXPO_PUBLIC_POSTHOG_API_KEY` / `EXPO_PUBLIC_POSTHOG_HOST` | Analítica |

## Ramas

- `main` — estable
- `dev` — desarrollo; abre los PR contra esta rama

## Licencia

MIT — ver [LICENSE](./LICENSE).
