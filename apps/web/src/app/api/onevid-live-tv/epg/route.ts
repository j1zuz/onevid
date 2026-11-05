import { LiveTvError } from "@/lib/live-tv";
import {
  liveTvApi,
  loadLiveTvEpg,
  validateLiveTvSourceId,
} from "@/lib/live-tv-server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return liveTvApi(async (userId) => {
    const params = new URL(request.url).searchParams;
    const sourceId = validateLiveTvSourceId(params.get("sourceId"));
    const channelId = params.get("channelId");
    if (!channelId || channelId.length > 200 || !channelId.trim()) {
      throw new LiveTvError(
        "Se requiere el identificador del canal de Live TV.",
      );
    }
    return {
      programmes: await loadLiveTvEpg(userId, sourceId, channelId.trim()),
    };
  });
}
