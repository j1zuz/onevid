#!/usr/bin/env bash
# Publica el APK de la app Dev (y opcionalmente el de Android TV) en el release
# fijo `app-dev` de GitHub, con una tabla de descargas en las notas.
#
# La app consulta `/api/onevid-app-update`, que lee el manifest de ese release
# (`onevid-dev.json`) y ofrece instalar el APK cuando la versión es más nueva
# que la instalada. Con este script los testers se actualizan desde la propia
# app, sin volver a pasarles un enlace.
#
# Uso:
#   ./scripts/publish-dev-release.sh --from-eas [--tv-from-eas] ["notas"]
#   ./scripts/publish-dev-release.sh <ruta.apk | URL> [--tv <ruta.apk | URL>] ["notas"]
#
#   --from-eas      usa el último build Android del perfil `preview` de EAS.
#   --tv-from-eas   usa el último build del perfil `preview-tv` (Android TV).
#   --tv <src>      añade el APK de Android TV (ruta local o URL).
#
# La versión sale de `dev-version.json` (o de la del build con --from-eas).
# Súbela antes de compilar.
#
# Requisitos: `gh` autenticado, `curl` y, para los --from-eas, `eas` autenticado.
set -euo pipefail

TAG="app-dev"
ASSET_APK="onevid-dev.apk"
ASSET_TV_APK="onevid-dev-tv.apk"
ASSET_MANIFEST="onevid-dev.json"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RELEASE_URL="https://github.com/j1zuz/onevid/releases/download/$TAG"

FROM_EAS=0
TV_FROM_EAS=0
SRC=""
TV_SRC=""
NOTES=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --from-eas) FROM_EAS=1; shift ;;
    --tv-from-eas) TV_FROM_EAS=1; shift ;;
    --tv) TV_SRC="${2:?falta la ruta/URL del APK de TV}"; shift 2 ;;
    --notes) NOTES="${2:?falta el texto de notas}"; shift 2 ;;
    *)
      if [[ -z "$SRC" ]]; then SRC="$1"; else NOTES="$1"; fi
      shift
      ;;
  esac
done

latest_build() {
  eas build:list --platform android --profile "$1" --limit 1 \
    --non-interactive --json | python3 -c '
import json, sys
build = json.load(sys.stdin)[0]
url = (build.get("artifacts") or {}).get("buildUrl") or ""
print(url)
print(build.get("appVersion") or "")
'
}

VERSION="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$APP_DIR/dev-version.json")"

if [[ "$FROM_EAS" == "1" ]]; then
  BUILD="$(latest_build preview)"
  SRC="$(sed -n '1p' <<<"$BUILD")"
  EAS_VERSION="$(sed -n '2p' <<<"$BUILD")"
  [[ -n "$EAS_VERSION" ]] && VERSION="$EAS_VERSION"
  [[ -n "$SRC" ]] || { echo "El último build de EAS no tiene artifact." >&2; exit 1; }
fi

if [[ "$TV_FROM_EAS" == "1" ]]; then
  BUILD="$(latest_build preview-tv)"
  TV_SRC="$(sed -n '1p' <<<"$BUILD")"
  [[ -n "$TV_SRC" ]] || { echo "El último build de TV no tiene artifact." >&2; exit 1; }
fi

[[ -n "$SRC" || -n "$TV_SRC" ]] || {
  echo "Uso: $0 <apk|url> [--tv <apk|url>] [notas] | $0 --from-eas [--tv-from-eas] [notas]" >&2
  exit 1
}

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

fetch_asset() {
  local source="$1" dest="$2"
  if [[ "$source" =~ ^https?:// ]]; then
    echo "Descargando $source"
    curl -fL --retry 3 -o "$dest" "$source"
  else
    [[ -f "$source" ]] || { echo "No existe el APK: $source" >&2; exit 1; }
    cp "$source" "$dest"
  fi
}

if [[ -n "$SRC" ]]; then
  fetch_asset "$SRC" "$WORKDIR/$ASSET_APK"
  python3 - "$WORKDIR/$ASSET_MANIFEST" "$VERSION" "$NOTES" <<'PY'
import json, sys
out, version, notes = sys.argv[1], sys.argv[2], sys.argv[3]
json.dump({"version": version, "notes": notes}, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
PY
fi

if [[ -n "$TV_SRC" ]]; then
  fetch_asset "$TV_SRC" "$WORKDIR/$ASSET_TV_APK"
fi

if gh release view "$TAG" >/dev/null 2>&1; then
  gh release upload "$TAG" "$WORKDIR"/* --clobber
else
  gh release create "$TAG" "$WORKDIR"/* --title "onevid Dev (APK)" --notes "Canal de actualizaciones de la app Dev."
fi

# Cuerpo de las notas: tabla de descargas con los assets reales del release
# (así no lista un APK de TV que todavía no se ha subido).
BODY="$(gh release view "$TAG" --json assets,body --jq '.assets[].name' | python3 -c '
import sys
names = [line.strip() for line in sys.stdin if line.strip()]
rows = []
labels = {
    "onevid-dev.apk": ("APK", "Android"),
    "onevid-dev-tv.apk": ("APK", "Android TV"),
}
for name in names:
    if name not in labels:
        continue
    pkg, platform = labels[name]
    rows.append(f"| {pkg} | {platform} | [{name}](https://github.com/j1zuz/onevid/releases/download/app-dev/{name}) |")
print("\n".join(rows))
')"

NOTES_BLOCK="$NOTES"
if [[ -z "$NOTES_BLOCK" ]]; then
  NOTES_BLOCK="$(gh release view "$TAG" --json body --jq '.body' | sed -n '/^## Novedades$/,$p' | tail -n +2)"
fi

{
  echo "Canal de actualizaciones de la app Dev."
  echo
  echo "## Descargas"
  echo
  echo "| Paquete | Plataforma | Descarga |"
  echo "| --- | --- | --- |"
  echo "$BODY"
  if [[ -n "${NOTES_BLOCK// /}" && "$NOTES_BLOCK" != "null" ]]; then
    echo
    echo "## Novedades"
    echo
    echo "$NOTES_BLOCK"
  fi
} > "$WORKDIR/body.md"

gh release edit "$TAG" --notes-file "$WORKDIR/body.md" >/dev/null

echo "Publicado onevid $VERSION en el release $TAG"
echo "La app lo verá en cuanto expire la caché del endpoint (máx. 5 min)."
