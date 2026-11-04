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

export async function GET() {
  return liveTvApi(async (userId) => ({
    sources: await listLiveTvSources(userId),
  }));
}

export async function POST(request: Request) {
  return liveTvApi(async (userId) => ({
    source: await createLiveTvSource(userId, await readLiveTvJson(request)),
  }));
}

export async function PATCH(request: Request) {
  return liveTvApi(async (userId) => ({
    source: await updateLiveTvSourceEpg(userId, await readLiveTvJson(request)),
  }));
}

export async function DELETE(request: Request) {
  return liveTvApi(async (userId) => {
    const body = await readLiveTvJson(request);
    const id = validateLiveTvSourceId(
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>).id
        : undefined,
    );
    return deleteLiveTvSource(userId, id);
  });
}
