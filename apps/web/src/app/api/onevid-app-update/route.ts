import { type NextRequest, NextResponse } from "next/server";

/**
 * Última versión publicada de la app Android (APK).
 *
 * Los builds se distribuyen como assets de un release fijo de GitHub, así que
 * las URLs no cambian entre versiones:
 *
 *   releases/download/app-dev/onevid-dev.apk   ← instalable
 *   releases/download/app-dev/onevid-dev.json  ← { version, notes }
 *
 * El manifest lo escribe `apps/mobile/scripts/publish-dev-release.sh` al
 * publicar. Aquí solo se lee y se devuelve a la app, que compara la versión
 * instalada con la remota y ofrece actualizar.
 *
 * Se cachea en el borde 5 minutos: publicar una versión tarda como máximo eso
 * en llegar, y no golpeamos GitHub en cada apertura de la app.
 */
const RELEASE_BASE = "https://github.com/j1zuz/onevid/releases/download";

const VARIANTS = {
  dev: {
    apk: `${RELEASE_BASE}/app-dev/onevid-dev.apk`,
    manifest: `${RELEASE_BASE}/app-dev/onevid-dev.json`,
  },
  prod: {
    apk: `${RELEASE_BASE}/app-prod/onevid.apk`,
    manifest: `${RELEASE_BASE}/app-prod/onevid.json`,
  },
} as const;

type Variant = keyof typeof VARIANTS;

interface UpdateManifest {
  version?: string;
  notes?: string;
  /** URL explícita (opcional); si falta se usa la del release fijo. */
  url?: string;
}

const CACHE_HEADERS = {
  "cache-control": "public, max-age=60, s-maxage=300",
} as const;

function resolveVariant(value: string | null): Variant {
  return value === "prod" || value === "production" ? "prod" : "dev";
}

export async function GET(request: NextRequest) {
  const variant = resolveVariant(
    new URL(request.url).searchParams.get("variant")
  );
  const release = VARIANTS[variant];

  try {
    const response = await fetch(release.manifest, {
      // `no-store` + Cache-Control de la respuesta: el borde de Cloudflare
      // cachea el JSON, no el fetch interno del Worker.
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      return NextResponse.json(
        { version: null },
        { headers: CACHE_HEADERS }
      );
    }
    const manifest = (await response.json()) as UpdateManifest;
    const version = manifest.version?.trim();
    if (!version) {
      return NextResponse.json(
        { version: null },
        { headers: CACHE_HEADERS }
      );
    }

    return NextResponse.json(
      {
        variant,
        version,
        notes: manifest.notes?.trim() ?? "",
        url: manifest.url?.trim() || release.apk,
      },
      { headers: CACHE_HEADERS }
    );
  } catch {
    // Sin red o GitHub caído: la app simplemente no ofrece actualizar.
    return NextResponse.json(
      { version: null },
      { status: 200, headers: { "cache-control": "no-store" } }
    );
  }
}
