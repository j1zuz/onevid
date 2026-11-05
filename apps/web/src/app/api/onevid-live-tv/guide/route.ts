import {
  liveTvApi,
  loadLiveTvGuide,
  readLiveTvJson,
} from "@/lib/live-tv-server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return liveTvApi(async (userId) =>
    loadLiveTvGuide(userId, await readLiveTvJson(request)),
  );
}
