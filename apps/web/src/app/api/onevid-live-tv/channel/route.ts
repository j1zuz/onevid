import { LiveTvError } from "@/lib/live-tv";
import {
  liveTvApi,
  loadLiveTvChannels,
  validateLiveTvSourceId,
} from "@/lib/live-tv-server";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Resuelve un único canal guardado en la biblioteca. El catálogo se sirve de la
 * caché en memoria de la fuente, así que abrir un favorito no re-descarga la
 * lista completa de canales salvo en el primer acceso.
 */
export async function GET(request: Request) {
  return liveTvApi(
    async (userId) => {
      const params = new URL(request.url).searchParams;
      const sourceId = validateLiveTvSourceId(params.get("sourceId"));
      const channelId = params.get("channelId")?.trim();
      if (!channelId || channelId.length > 200) {
        throw new LiveTvError("Se requiere el identificador del canal.");
      }
      const channels = await loadLiveTvChannels(userId, sourceId);
      const channel = channels.find((item) => item.id === channelId);
      if (!channel) {
        throw new LiveTvError("Canal no encontrado.", 404);
      }
      return { channel };
    },
    { scope: "live-tv-channel", limit: 120 },
  );
}
