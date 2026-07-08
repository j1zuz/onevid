import { count, desc, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { oneVidAddon } from "@/lib/auth-schema";
import { db } from "@/lib/db";
import { isSafeFetchUrl, safeFetch } from "@/utils/ssrf-guard";

const MAX_ADDONS_PER_USER = 20;
const TRAILING_SLASH_REGEX = /\/+$/;
const TRAILING_MANIFEST_REGEX = /\/manifest(?:\.json)?\/*$/i;

interface CreatePayload {
  baseUrl?: unknown;
}

interface ManifestResult {
  baseUrl: string;
  manifestDescription: string;
  manifestId: string;
  manifestName: string;
  manifestVersion: string;
  supportsStreams: boolean;
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

async function fetchManifest(baseUrl: string): Promise<ManifestResult> {
  const safety = isSafeFetchUrl(`${baseUrl}/manifest`);
  if (!safety.ok) {
    throw new Error(safety.reason);
  }

  const response = await safeFetch(`${baseUrl}/manifest`, {
    method: "GET",
    headers: { accept: "application/json" },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("No se pudo obtener /manifest del servidor OneVLP");
  }

  let manifest: unknown;
  try {
    manifest = (await response.json()) as unknown;
  } catch {
    throw new Error("El /manifest no devolvió JSON válido");
  }

  if (typeof manifest !== "object" || manifest === null) {
    throw new Error("El /manifest no es un objeto JSON");
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

  if (
    typeof obj.supported_endpoints !== "object" ||
    obj.supported_endpoints === null
  ) {
    throw new Error("El manifest no incluye `supported_endpoints`");
  }

  const supported = obj.supported_endpoints as Record<string, unknown>;
  const streamsPath =
    typeof supported.streams === "string" ? supported.streams.trim() : "";

  if (!streamsPath) {
    throw new Error(
      "El servidor OneVLP debe declarar `supported_endpoints.streams`"
    );
  }
  if (!streamsPath.startsWith("/")) {
    throw new Error("`supported_endpoints.streams` debe empezar con `/`");
  }

  return {
    baseUrl,
    manifestId: id,
    manifestName: name,
    manifestVersion: version,
    manifestDescription: description,
    supportsStreams: true,
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
      createdAt: oneVidAddon.createdAt,
    })
    .from(oneVidAddon)
    .where(eq(oneVidAddon.userId, session.user.id))
    .orderBy(desc(oneVidAddon.createdAt));

  return Response.json({ items: rows });
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

  await db.insert(oneVidAddon).values({
    id,
    userId: session.user.id,
    baseUrl: metadata.baseUrl,
    manifestId: metadata.manifestId,
    manifestName: metadata.manifestName,
    manifestVersion: metadata.manifestVersion,
    manifestDescription: metadata.manifestDescription,
    supportsStreams: metadata.supportsStreams,
    createdAt: now,
    updatedAt: now,
  });

  return Response.json(
    {
      item: {
        id,
        baseUrl: metadata.baseUrl,
        manifestId: metadata.manifestId,
        manifestName: metadata.manifestName,
        manifestVersion: metadata.manifestVersion,
        manifestDescription: metadata.manifestDescription,
        supportsStreams: metadata.supportsStreams,
        createdAt: now,
      },
    },
    { status: 201 }
  );
}
