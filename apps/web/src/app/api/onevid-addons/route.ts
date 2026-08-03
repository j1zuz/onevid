import { count, desc, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { oneVidAddon } from "@/lib/auth-schema";
import { db } from "@/lib/db";
import type { AddonCatalogRef } from "@/lib/onevid-feed";
import { isSafeFetchUrl, safeFetch } from "@/utils/ssrf-guard";

const MAX_ADDONS_PER_USER = 20;
const TRAILING_SLASH_REGEX = /\/+$/;
const TRAILING_MANIFEST_REGEX = /\/manifest(?:\.json)?\/*$/i;

interface CreatePayload {
  baseUrl?: unknown;
}

interface ManifestResult {
  baseUrl: string;
  catalogs: AddonCatalogRef[];
  manifestDescription: string;
  manifestId: string;
  manifestName: string;
  manifestVersion: string;
  supportsStreams: boolean;
  supportsStremioStreams: boolean;
}

/**
 * Lee `manifest.catalogs` (formato Stremio: `[{ id, type, name }]`). Es
 * independiente de `supported_endpoints.streams` (OneVLP): un addon puede
 * traer solo streams, solo catálogos, o ambos. Entradas inválidas se
 * descartan en vez de invalidar el manifest entero.
 */
function parseManifestCatalogs(obj: Record<string, unknown>): AddonCatalogRef[] {
  if (!Array.isArray(obj.catalogs)) {
    return [];
  }
  const catalogs: AddonCatalogRef[] = [];
  for (const raw of obj.catalogs) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const { id, type, name } = raw as Record<string, unknown>;
    if (
      typeof id === "string" &&
      id.trim() &&
      typeof name === "string" &&
      name.trim() &&
      (type === "movie" || type === "series")
    ) {
      catalogs.push({ id: id.trim(), name: name.trim(), type });
    }
  }
  return catalogs;
}

function normalizeBaseUrl(input: string): string {
  return input
    .trim()
    .replace(TRAILING_SLASH_REGEX, "")
    .replace(TRAILING_MANIFEST_REGEX, "");
}

function buildId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Intenta leer un manifest JSON de una URL puntual. Devuelve `null` (en vez de
 * lanzar) ante cualquier fallo, para que `fetchManifest` pueda probar la
 * siguiente ruta candidata sin que un 404 individual aborte todo el flujo.
 */
async function tryFetchManifestJson(url: string): Promise<unknown | null> {
  const safety = isSafeFetchUrl(url);
  if (!safety.ok) {
    throw new Error(safety.reason);
  }

  const response = await safeFetch(url, {
    method: "GET",
    headers: { accept: "application/json" },
    cache: "no-store",
  });

  if (!response.ok) {
    return null;
  }

  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

async function fetchManifest(baseUrl: string): Promise<ManifestResult> {
  // Los addons OneVLP sirven su manifest en `/manifest` (sin extensión). Los
  // addons Stremio estándar (de los que también podemos leer catálogos, ver
  // parseManifestCatalogs) solo sirven `/manifest.json` — probamos ambas rutas
  // para poder registrar cualquiera de los dos tipos.
  const manifest =
    (await tryFetchManifestJson(`${baseUrl}/manifest`)) ??
    (await tryFetchManifestJson(`${baseUrl}/manifest.json`));

  if (manifest === null) {
    throw new Error("No se pudo obtener /manifest ni /manifest.json del servidor");
  }

  if (typeof manifest !== "object") {
    throw new Error("El manifest no es un objeto JSON");
  }

  const obj = manifest as Record<string, unknown>;
  const id = typeof obj.id === "string" ? obj.id.trim() : "";
  const name = typeof obj.name === "string" ? obj.name.trim() : "";
  const version = typeof obj.version === "string" ? obj.version.trim() : "";
  const description =
    typeof obj.description === "string" ? obj.description.trim() : "";

  if (!id) {
    throw new Error("El manifest no incluye `id`");
  }
  if (!name) {
    throw new Error("El manifest no incluye `name`");
  }
  if (!version) {
    throw new Error("El manifest no incluye `version`");
  }
  if (!description) {
    throw new Error("El manifest no incluye `description`");
  }

  // `supported_endpoints.streams` (OneVLP) es opcional: un addon puede traer
  // solo catálogos (formato Stremio, `manifest.catalogs`), solo streams, o
  // ambos. Solo se rechaza si el manifest no declara ninguna de las dos
  // cosas, porque entonces no hay nada que este addon pueda ofrecerle a onevid.
  let supportsStreams = false;
  if (
    typeof obj.supported_endpoints === "object" &&
    obj.supported_endpoints !== null
  ) {
    const supported = obj.supported_endpoints as Record<string, unknown>;
    const streamsPath =
      typeof supported.streams === "string" ? supported.streams.trim() : "";
    if (streamsPath) {
      if (!streamsPath.startsWith("/")) {
        throw new Error("`supported_endpoints.streams` debe empezar con `/`");
      }
      supportsStreams = true;
    }
  }

  // Addons Stremio estándar declaran `resources: ["stream", ...]` (o, en su
  // forma extendida, `[{ name: "stream", ... }, ...]`) en vez del
  // `supported_endpoints.streams` de OneVLP. Ambos protocolos son
  // independientes: un addon puede soportar uno, otro, o ambos. Ver
  // `fetchAddonStremioStreams` en stream/sources/route.ts para el consumo.
  const supportsStremioStreams =
    Array.isArray(obj.resources) &&
    obj.resources.some(
      (resource) =>
        resource === "stream" ||
        (typeof resource === "object" &&
          resource !== null &&
          (resource as Record<string, unknown>).name === "stream")
    );

  const catalogs = parseManifestCatalogs(obj);

  if (!(supportsStreams || supportsStremioStreams || catalogs.length > 0)) {
    throw new Error(
      "El manifest no declara `supported_endpoints.streams`, `resources: [\"stream\"]` ni `catalogs`"
    );
  }

  return {
    baseUrl,
    catalogs,
    manifestId: id,
    manifestName: name,
    manifestVersion: version,
    manifestDescription: description,
    supportsStreams,
    supportsStremioStreams,
  };
}

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  const rows = await db
    .select({
      id: oneVidAddon.id,
      baseUrl: oneVidAddon.baseUrl,
      manifestId: oneVidAddon.manifestId,
      manifestName: oneVidAddon.manifestName,
      manifestVersion: oneVidAddon.manifestVersion,
      manifestDescription: oneVidAddon.manifestDescription,
      supportsStreams: oneVidAddon.supportsStreams,
      supportsStremioStreams: oneVidAddon.supportsStremioStreams,
      catalogs: oneVidAddon.catalogs,
      createdAt: oneVidAddon.createdAt,
    })
    .from(oneVidAddon)
    .where(eq(oneVidAddon.userId, session.user.id))
    .orderBy(desc(oneVidAddon.createdAt));

  return Response.json({
    items: rows.map((row) => ({ ...row, catalogs: row.catalogs ?? [] })),
  });
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  let payload: CreatePayload;
  try {
    payload = (await request.json()) as CreatePayload;
  } catch {
    return Response.json({ error: "Body JSON inválido" }, { status: 400 });
  }

  const rawBaseUrl = typeof payload.baseUrl === "string" ? payload.baseUrl : "";
  const baseUrl = normalizeBaseUrl(rawBaseUrl);

  if (!baseUrl) {
    return Response.json(
      { error: "`baseUrl` es obligatorio" },
      { status: 400 }
    );
  }

  const safety = isSafeFetchUrl(baseUrl);
  if (!safety.ok) {
    return Response.json({ error: safety.reason }, { status: 400 });
  }

  const [{ value: existingCount }] = await db
    .select({ value: count() })
    .from(oneVidAddon)
    .where(eq(oneVidAddon.userId, session.user.id));

  if (existingCount >= MAX_ADDONS_PER_USER) {
    return Response.json(
      { error: `Límite de ${MAX_ADDONS_PER_USER} complementos alcanzado` },
      { status: 400 }
    );
  }

  let metadata: ManifestResult;
  try {
    metadata = await fetchManifest(baseUrl);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "No se pudo procesar el manifest";
    return Response.json({ error: message }, { status: 400 });
  }

  const id = buildId();
  const now = new Date();

  try {
    await db.insert(oneVidAddon).values({
      id,
      userId: session.user.id,
      baseUrl: metadata.baseUrl,
      manifestId: metadata.manifestId,
      manifestName: metadata.manifestName,
      manifestVersion: metadata.manifestVersion,
      manifestDescription: metadata.manifestDescription,
      supportsStreams: metadata.supportsStreams,
      supportsStremioStreams: metadata.supportsStremioStreams,
      catalogs: metadata.catalogs,
      createdAt: now,
      updatedAt: now,
    });
  } catch (error) {
    // Sin esto, un error de DB (p. ej. una columna nueva del schema que
    // todavía no corrió su `drizzle-kit push` contra esta base) tumbaba la
    // ruta sin JSON de respuesta, y el cliente caía al mensaje genérico
    // "Error al añadir el complemento" sin ninguna pista de la causa real.
    const message =
      error instanceof Error ? error.message : "No se pudo guardar el complemento";
    return Response.json({ error: message }, { status: 500 });
  }

  return Response.json(
    {
      item: {
        id,
        baseUrl: metadata.baseUrl,
        catalogs: metadata.catalogs,
        manifestId: metadata.manifestId,
        manifestName: metadata.manifestName,
        manifestVersion: metadata.manifestVersion,
        manifestDescription: metadata.manifestDescription,
        supportsStreams: metadata.supportsStreams,
        supportsStremioStreams: metadata.supportsStremioStreams,
        createdAt: now,
      },
    },
    { status: 201 }
  );
}
