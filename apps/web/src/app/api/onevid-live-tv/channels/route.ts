import {
  liveTvApi,
  loadLiveTvChannels,
  validateLiveTvSourceId,
} from "@/lib/live-tv-server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return liveTvApi(async (userId) => {
    const id = validateLiveTvSourceId(
      new URL(request.url).searchParams.get("sourceId"),
    );
    return { channels: await loadLiveTvChannels(userId, id) };
  });
}
