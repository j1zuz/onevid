import {
  liveTvApi,
  loadLiveTvChannels,
  validateLiveTvSourceId,
} from "@/lib/live-tv-server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return liveTvApi(async (userId) => {
    const params = new URL(request.url).searchParams;
    const id = validateLiveTvSourceId(params.get("sourceId"));
    const channels = await loadLiveTvChannels(userId, id);

    // El editor de filas solo necesita las categorías, no los miles de canales.
    if (params.get("groups") === "1") {
      return {
        groups: [...new Set(channels.map((channel) => channel.group))]
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b)),
      };
    }

    const group = params.get("group");
    const filtered = group
      ? channels.filter((channel) => channel.group === group)
      : channels;
    const limit = Number(params.get("limit"));
    return {
      channels:
        Number.isInteger(limit) && limit > 0
          ? filtered.slice(0, limit)
          : filtered,
    };
  });
}
