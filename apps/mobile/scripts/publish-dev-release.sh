#!/usr/bin/env bash
# Publica un APK de la app Dev en el release fijo `app-dev` de GitHub.
#
# La app consulta `/api/onevid-app-update`, que lee el manifest de ese release
# (`onevid-dev.json`) y ofrece instalar el APK cuando la versión es más nueva
# que la instalada. Con este script los testers se actualizan desde la propia
# app, sin volver a pasarles un enlace.
#
# Uso:
#   ./scripts/publish-dev-release.sh <ruta.apk | URL> ["notas"]
#   ./scripts/publish-dev-release.sh --from-eas ["notas"]
#
#   --from-eas  coge el último build Android del perfil `preview` terminado en
#               EAS (el mismo que se comparte con `eas build`), descarga su APK
#               y publica versión y notas. Así no hace falta compilar local.
#
# La versión sale de `dev-version.json` (o de la del build con --from-eas). Súbela
# antes de compilar: si el APK y el manifest tienen la misma versión que la
# instalada, la app no ofrece actualizar.
#
# Requisitos: `gh` autenticado, `curl`, y para --from-eas, `eas` autenticado.
set -euo pipefail

MODE="${1:-}"
NOTES="${2:-}"
TAG="app-dev"
ASSET_APK="onevid-dev.apk"
ASSET_MANIFEST="onevid-dev.json"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [[ "$MODE" == "--from-eas" ]]; then
  SOURCE="$(eas build:list --platform android --profile preview --limit 1 \
    --non-interactive --json | python3 -c '
import json, sys
build = json.load(sys.stdin)[0]
url = (build.get("artifacts") or {}).get("buildUrl") or ""
version = build.get("appVersion") or ""
print(url)
print(version)
')"
  APK_URL="$(sed -n '1p' <<<"$SOURCE")"
  EAS_VERSION="$(sed -n '2p' <<<"$SOURCE")"
  if [[ -z "$APK_URL" ]]; then
    echo "El último build de EAS no tiene artifact (¿terminó bien?)." >&2
    exit 1
  fi
  SRC="$APK_URL"
  VERSION="${EAS_VERSION:-$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$APP_DIR/dev-version.json")}"
elif [[ -n "$MODE" ]]; then
  SRC="$MODE"
  VERSION="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$APP_DIR/dev-version.json")"
else
  echo "Uso: $0 <ruta.apk | URL> [notas] | $0 --from-eas [notas]" >&2
  exit 1
fi

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

if [[ "$SRC" =~ ^https?:// ]]; then
  echo "Descargando $SRC"
  curl -fL --retry 3 -o "$WORKDIR/$ASSET_APK" "$SRC"
else
  if [[ ! -f "$SRC" ]]; then
    echo "No existe el APK: $SRC" >&2
    exit 1
  fi
  cp "$SRC" "$WORKDIR/$ASSET_APK"
fi

python3 - "$WORKDIR/$ASSET_MANIFEST" "$VERSION" "$NOTES" <<'PY'
import json, sys
out, version, notes = sys.argv[1], sys.argv[2], sys.argv[3]
json.dump({"version": version, "notes": notes}, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
PY

if gh release view "$TAG" >/dev/null 2>&1; then
  gh release upload "$TAG" "$WORKDIR/$ASSET_APK" "$WORKDIR/$ASSET_MANIFEST" --clobber
else
  gh release create "$TAG" \
    "$WORKDIR/$ASSET_APK" "$WORKDIR/$ASSET_MANIFEST" \
    --title "onevid Dev (APK)" \
    --notes "Canal de actualizaciones de la app Dev. La app revisa este release al abrirse."
fi

echo "Publicado onevid $VERSION en el release $TAG"
echo "La app lo verá en cuanto expire la caché del endpoint (máx. 5 min)."
