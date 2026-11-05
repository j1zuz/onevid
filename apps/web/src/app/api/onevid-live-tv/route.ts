import {
  createLiveTvSource,
  deleteLiveTvSource,
  liveTvApi,
  listLiveTvSources,
  readLiveTvJson,
  updateLiveTvSourceEpg,
  validateLiveTvSourceId,
} from "@/lib/live-tv-server";

export const runtime = "nodejs";
// El catálogo Xtream (miles de canales), la guía y el EPG pueden tardar
// más que el límite por defecto de la plataforma en producción.
export const maxDuration = 60;

export async function GET() {
  return liveTvApi(
    async (userId) => ({
      sources: await listLiveTvSources(userId),
    }),
    { scope: "live-tv-sources-read", limit: 120 }
  );
}

export async function POST(request: Request) {
  return liveTvApi(
    async (userId) => ({
      source: await createLiveTvSource(userId, await readLiveTvJson(request)),
    }),
    { scope: "live-tv-sources-write", limit: 10 }
  );
}

export async function PATCH(request: Request) {
  return liveTvApi(
    async (userId) => ({
      source: await updateLiveTvSourceEpg(userId, await readLiveTvJson(request)),
    }),
    { scope: "live-tv-sources-write", limit: 10 }
  );
}

export async function DELETE(request: Request) {
  return liveTvApi(
    async (userId) => {
      const body = await readLiveTvJson(request);
      const id = validateLiveTvSourceId(
        body && typeof body === "object" && !Array.isArray(body)
          ? (body as Record<string, unknown>).id
          : undefined,
      );
      return deleteLiveTvSource(userId, id);
    },
    { scope: "live-tv-sources-write", limit: 10 }
  );
}
