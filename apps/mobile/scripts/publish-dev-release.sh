#!/usr/bin/env bash
# Publica un APK de la app Dev en el release fijo `app-dev` de GitHub.
#
# La app consulta `/api/onevid-app-update`, que lee el manifest de ese release
# (`onevid-dev.json`) y ofrece instalar el APK cuando la versión es más nueva
# que la instalada. Con este script los testers se actualizan desde la propia
# app, sin volver a pasarles un enlace.
#
# Uso:
#   ./scripts/publish-dev-release.sh <ruta-del.apk> ["notas de la versión"]
#
# La versión sale de `app.json` (campo `version`). Súbela ANTES de compilar el
# APK; si no, la app instalada y el manifest quedan con la misma versión y no
# se ofrece la actualización.
#
# Requisitos: `gh` autenticado con permiso sobre el repo y el APK ya compilado
# (por ejemplo `bun --filter onevid build:android`).
set -euo pipefail

APK="${1:?Falta la ruta del APK}"
NOTES="${2:-}"
TAG="app-dev"
ASSET_APK="onevid-dev.apk"
ASSET_MANIFEST="onevid-dev.json"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [[ ! -f "$APK" ]]; then
  echo "No existe el APK: $APK" >&2
  exit 1
fi

VERSION="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$APP_DIR/app.json")"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

cp "$APK" "$WORKDIR/$ASSET_APK"
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
