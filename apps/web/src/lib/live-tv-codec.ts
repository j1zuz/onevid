import type { AudioCodec, InputAudioTrack, MediaCodec } from "mediabunny";

/**
 * Codecs de audio que hls.js no puede reproducir en la mayoría de navegadores
 * porque MSE (`MediaSource.isTypeSupported`) no los acepta, pero que MediaBunny
 * sí puede decodificar con sus extensiones WASM (ac3, dts, truehd).
 *
 * MP2 (MPEG-1 Layer II) queda fuera a propósito: no hay decoder de MediaBunny
 * para él, así que sigue cayendo al reproductor nativo (sin audio).
 */
const TRANSCODABLE_AUDIO_CODECS: ReadonlySet<string> = new Set([
  "ac3",
  "eac3",
  "dts",
  "truehd",
]);

/**
 * Codec string que MSE espera para cada codec de MediaBunny. Solo hace falta
 * cuando el parámetro del track no es ya un string válido de MSE.
 */
const MSE_AUDIO_CODEC: Partial<Record<AudioCodec, string>> = {
  ac3: "ac-3",
  eac3: "ec-3",
  dts: "dtsc",
  truehd: "mlpa",
  aac: "mp4a.40.2",
  mp3: "mp4a.40.34",
  opus: "opus",
  flac: "flac",
};

/** Mime de audio que usaría hls.js para el track, o `null` si no hay codec. */
export function audioMseMime(
  codec: MediaCodec | null,
  parameter: string | null,
): string | null {
  if (codec === "aac" && parameter) {
    // AAC siempre declara su perfil real (`mp4a.40.2`, `mp4a.40.5`…); el mapeo
    // fijo es solo el fallback.
    return `audio/mp4; codecs="${parameter}"`;
  }
  const value =
    (codec ? MSE_AUDIO_CODEC[codec as AudioCodec] : undefined) ??
    parameter ??
    codec;
  return value ? `audio/mp4; codecs="${value}"` : null;
}

export interface LiveTvProbedAudioTrack {
  codec: MediaCodec | null;
  mseSupported: boolean;
}

/**
 * Decide si el canal necesita el pipeline de MediaBunny o puede seguir con
 * hls.js. La regla:
 *
 * - Si alguna pista de audio ya la acepta MSE, hls.js se arregla solo (puede
 *   elegir esa pista) → nativo.
 * - Si ninguna la acepta pero el codec es uno que MediaBunny sabe decodificar
 *   (AC-3/E-AC-3/DTS/TrueHD) → transcodificar.
 * - Cualquier otro caso (p. ej. MP2) → nativo: no empeoramos lo que ya había.
 */
export function decideLiveTvAudioPlan(
  tracks: readonly LiveTvProbedAudioTrack[],
): "native" | "transcode" {
  if (tracks.length === 0) {
    return "native";
  }
  if (tracks.some((track) => track.mseSupported)) {
    return "native";
  }
  return tracks.some(
    (track) =>
      track.codec !== null && TRANSCODABLE_AUDIO_CODECS.has(track.codec),
  )
    ? "transcode"
    : "native";
}

async function probeTrack(
  track: InputAudioTrack,
): Promise<LiveTvProbedAudioTrack> {
  const [codec, parameter] = await Promise.all([
    track.getCodec(),
    track.getCodecParameterString(),
  ]);
  const mime = audioMseMime(codec, parameter);
  return {
    codec,
    mseSupported: mime ? MediaSource.isTypeSupported(mime) : false,
  };
}

/**
 * Lee solo los metadatos del HLS (playlist maestra, o el primer segmento si es
 * una playlist de medios) para saber si el audio del canal es reproducible de
 * forma nativa. Cualquier fallo (CORS, red, manifiesto raro) se resuelve como
 * "nativo": el canal se reproduce como hasta ahora y nunca empeora.
 */
export async function probeLiveTvAudio(
  url: string,
  signal?: AbortSignal,
): Promise<"native" | "transcode"> {
  if (typeof window === "undefined" || typeof MediaSource === "undefined") {
    return "native";
  }
  try {
    const { ALL_FORMATS, Input, UrlSource } = await import("mediabunny");
    if (signal?.aborted) {
      return "native";
    }
    const input = new Input({
      source: new UrlSource(url),
      formats: ALL_FORMATS,
      // Igual que el pipeline de reproducción: timestamps relativos, no anclados
      // al epoch. Solo afecta a la lectura; acá únicamente importan los codecs.
      formatOptions: { hls: { offsetTimestampsByDateTime: false } },
    });
    const tracks = await input.getAudioTracks();
    if (signal?.aborted) {
      return "native";
    }
    const probed = await Promise.all(tracks.map(probeTrack));
    return decideLiveTvAudioPlan(probed);
  } catch {
    return "native";
  }
}
