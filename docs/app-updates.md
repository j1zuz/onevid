# Actualizaciones de la app Android (Dev)

La app **Dev** (`tech.hackw.onevid.dev`) se actualiza sola desde la propia app:
al abrirse consulta si hay un APK más nuevo y ofrece descargarlo e instalarlo.
Así los testers no dependen de que se les pase un enlace cada vez.

## Cómo funciona

```
app Dev  ──GET──▶  /api/onevid-app-update?variant=dev
                         │
                         ▼
        github.com/j1zuz/onevid/releases/download/app-dev/onevid-dev.json
                         │  { "version": "1.3.0", "notes": "…" }
                         ▼
   ¿version > Application.nativeApplicationVersion?
        sí → pantalla /update → descarga onevid-dev.apk → instalador
```

- **Endpoint**: `apps/web/src/app/api/onevid-app-update/route.ts`. Cachea 5 min
  en el borde; sin red o sin release devuelve `{ "version": null }` y la app no
  molesta.
- **Release fijo**: tag `app-dev`, assets `onevid-dev.apk` y `onevid-dev.json`.
  Al ser un release fijo (no `latest`), las URLs nunca cambian y no chocan con
  el release de producción (`app-prod`).
- **Permiso**: `REQUEST_INSTALL_PACKAGES` se declara solo en la variante
  development (`app.config.ts`); producción se actualiza desde la tienda.
- **Pantalla**: `apps/mobile/src/app/update.tsx`. Se abre sola al arrancar si hay
  versión nueva, y también desde Configuración → "Buscar actualizaciones".
- **Instalación**: descarga el APK al cache y abre el instalador con
  `expo-intent-launcher`. Si el intent falla (permiso de "apps desconocidas" no
  concedido), cae al navegador con la URL del APK.

## Publicar una versión

La versión de la variante Dev vive en `apps/mobile/dev-version.json`, **no** en
`app.json`: así una release de pruebas no cambia la versión de producción.

1. Sube `version` en `apps/mobile/dev-version.json` (por ejemplo `1.0.2`).
2. Compila en EAS (nube, sin toolchain local):
   ```bash
   cd apps/mobile
   eas build --profile preview --platform android
   ```
   o local con `bun --filter onevid build:android`.
3. Publícalo. Con el último build de EAS ya terminado:
   ```bash
   ./scripts/publish-dev-release.sh --from-eas "Arregla el chat de Ver juntos"
   ```
   o con un APK/URL concreta:
   ```bash
   ./scripts/publish-dev-release.sh ./onevid-dev.apk "Notas"
   ```
   El script escribe el manifest y crea/actualiza el release `app-dev` (con
   `--clobber`). El enlace de instalación de EAS sigue sirviendo para instalar
   a mano la primera vez; luego ya lo hace la app.

En un máximo de 5 minutos la app lo detecta; si ya estaba abierta, al volver a
abrirla.

## Notas

- Solo Android: iOS no permite instalar APKs fuera de la tienda, así que la
  pantalla muestra "Actualiza desde la tienda".
- El APK se instala **encima** de la app existente (mismo package y firma). Tus
  datos, perfiles y sesión se conservan.
- Si el usuario no tiene activado "Instalar apps desconocidas" para onevid,
  Android lo pedirá una vez; después el botón funciona directo.
- Los cambios solo de JavaScript pueden seguir yendo por OTA (`eas update`) sin
  pasar por aquí; este flujo es para builds nativos (icono, permisos, librerías).

## Android TV

El perfil `preview-tv` compila el APK de TV con la misma variante development
(icono beta incluido). Se publica en el mismo release:

```bash
cd apps/mobile
eas build --profile preview-tv --platform android
./scripts/publish-dev-release.sh --from-eas --tv-from-eas "Notas"
```

En Android TV no hay instalador accesible, así que la app no muestra el aviso
de actualización: la TV se actualiza con adb/EAS. El APK queda en la tabla de
descargas del release para instalarlo a mano.
