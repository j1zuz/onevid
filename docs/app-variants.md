# Variantes de app (Dev y Producción)

La app móvil se compila en dos variantes que **conviven instaladas en el mismo
dispositivo**. Es lo que permite tener la app de Play Store y una versión de
prueba a la vez, sin desinstalar nada.

| | Producción | Dev |
|---|---|---|
| Nombre | `onevid` | `onevid Dev` |
| Android package | `tech.hackw.onevid` | `tech.hackw.onevid.dev` |
| iOS bundle id | `tech.hackw.onevid` | `tech.hackw.onevid.dev` |
| Icono | `onevid-icon.png` | `onevid-icon-dev.png` (marco azul) |
| Perfil EAS para usuarios | `production` | `preview` (release + internal) |
| Canal de OTA | `production` | `preview` |
| `APP_VARIANT` | `production` | `development` |

La identidad (nombre, package/bundle id, icono) se hornea en el build nativo:
no se puede cambiar con `expo start`, solo reconstruyendo.

## Cómo funciona

- `app.json` es la capa base con los valores estables (plugins, splash,
  permisos, `runtimeVersion`…).
- `app.config.ts` lee `APP_VARIANT` y sobreescribe solo lo que depende de la
  variante. Si la variable falta, cae en **Dev** a propósito: producción solo se
  genera pidiéndola explícitamente.
- `src/lib/app-variant.ts` resuelve la variante **en runtime** a partir de
  `applicationId` (expo-application), no de `Constants.expoConfig`: en un
  development build el config se descarga del dev server y puede no coincidir
  con la identidad compilada.

## Build Dev para testers

Es un build **release** (`preview` no usa `developmentClient`) con distribución
interna: lleva el JS embebido y se instala sin dev server ni cable.

```console
# Android (APK/AAB de distribución interna)
bun run --filter onevid build:android            # eas build --profile preview --local

# iOS (ad hoc: hay que registrar el UDID de cada dispositivo en EAS)
eas build --profile preview --platform ios
```

EAS devuelve un enlace de instalación. En iOS la distribución `internal` es ad
hoc: un dispositivo no listado no puede instalar el build.

### Actualizaciones sin recompilar

Los builds Dev escuchan el canal `preview`:

```console
bun run --filter onevid update      # APP_VARIANT=development eas update --channel preview
```

Solo llegan a builds con el mismo `runtimeVersion` (hoy `policy: appVersion`,
así que coincide mientras la versión siga en `1.0.0`). Si el cambio toca código
nativo o sube la versión, hay que recompilar.

## Desarrollo local

```console
cd apps/mobile

# Identidad Dev en el proyecto nativo (obligatorio al cambiar de variante)
bun run prebuild:dev          # APP_VARIANT=development expo prebuild --clean
bun run android               # expo run:android (dev client)

# Para volver a la identidad de producción
bun run prebuild:prod
```

El dev client y el build Dev de los testers comparten identificador `.dev`, así
que en tu propio teléfono se reemplazan entre sí (en el de un tester no, porque
no tiene dev client). El QR de `expo start` abre el dev client: el plugin
`expo-dev-client` solo registra el scheme `exp+onevid` en la variante Dev.

## Publicar en Play Store / App Store

Solo con el perfil `production`, que fija `APP_VARIANT=production`:

```console
eas build --profile production
eas submit --profile production
```

Si se subiera un build `.dev`, la tienda lo rechaza (el identificador no existe
allí) — es justamente la red de seguridad.

## Cosas a tener en cuenta

- **Analytics**: ambos builds mandan a PostHog, pero los eventos llevan
  `app_variant: "development" | "production"`. Filtra por esa propiedad para
  excluir a los testers de los embudos reales.
- **Backend**: las dos variantes apuntan al mismo `EXPO_PUBLIC_API_URL`
  (producción). Si un cambio necesita backend nuevo, hay que desplegarlo antes o
  darle a Dev su propia URL en `app.config.ts` (helper + `extra`).
- **Deep links**: el scheme `onevid://` es el mismo en ambas variantes; si algún
  enlace externo debe abrir una concreta, hay que separarlo.
- **TV**: `EXPO_TV=1` reutiliza la misma identidad que móvil (comportamiento
  previo a las variantes). Los perfiles `*-tv` heredan el `APP_VARIANT`
  correspondiente.
- **Servicios por identificador**: si se añade push, Google Maps o similar, cada
  variante necesita su registro (el id `.dev` es otra app para esos servicios).
- **Sourcemaps de PostHog**: en builds release el plugin sube los sourcemaps con
  `posthog-cli`, que tiene que estar instalado (`@posthog/cli` en
  `devDependencies`). Si falta, el build falla en la tarea
  `createBundleReleaseJsAndAssets_PostHogUpload_*` aunque Gradle diga
  "unknown error". Requiere `POSTHOG_CLI_API_KEY` y `POSTHOG_CLI_PROJECT_ID` en
  el entorno de EAS.
