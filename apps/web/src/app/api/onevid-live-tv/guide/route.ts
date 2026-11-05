import {
  liveTvApi,
  loadLiveTvGuide,
  readLiveTvJson,
} from "@/lib/live-tv-server";

export const runtime = "nodejs";
// El catálogo Xtream (miles de canales), la guía y el EPG pueden tardar
// más que el límite por defecto de la plataforma en producción.
export const maxDuration = 60;

export async function POST(request: Request) {
  return liveTvApi(
    async (userId) => loadLiveTvGuide(userId, await readLiveTvJson(request)),
    { scope: "live-tv-guide", limit: 30 }
  );
}
