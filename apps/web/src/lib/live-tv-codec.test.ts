// @ts-expect-error -- Bun provides this runner at runtime; this repo does not install Bun type declarations.
import { describe, expect, test } from "bun:test";
import { audioMseMime, decideLiveTvAudioPlan } from "./live-tv-codec";

describe("Live TV audio plan", () => {
  test("keeps hls.js when the browser can already play the audio", () => {
    expect(
      decideLiveTvAudioPlan([{ codec: "aac", mseSupported: true }]),
    ).toBe("native");
    // Una sola pista compatible basta: hls.js elige esa.
    expect(
      decideLiveTvAudioPlan([
        { codec: "ac3", mseSupported: false },
        { codec: "aac", mseSupported: true },
      ]),
    ).toBe("native");
  });

  test("transcodes the codecs that MediaBunny can decode", () => {
    for (const codec of ["ac3", "eac3", "dts", "truehd"] as const) {
      expect(decideLiveTvAudioPlan([{ codec, mseSupported: false }])).toBe(
        "transcode",
      );
    }
  });

  test("does not promise a fix for codecs MediaBunny cannot decode", () => {
    // MP2 no tiene decoder en MediaBunny: se queda como hasta ahora.
    expect(
      decideLiveTvAudioPlan([{ codec: "mp3", mseSupported: false }]),
    ).toBe("native");
    expect(decideLiveTvAudioPlan([])).toBe("native");
  });

  test("builds the MSE mime for the codec the track declares", () => {
    expect(audioMseMime("ac3", null)).toBe('audio/mp4; codecs="ac-3"');
    expect(audioMseMime("eac3", null)).toBe('audio/mp4; codecs="ec-3"');
    expect(audioMseMime("dts", null)).toBe('audio/mp4; codecs="dtsc"');
    expect(audioMseMime("truehd", null)).toBe('audio/mp4; codecs="mlpa"');
    // AAC usa el perfil real de la pista, no un LC fijo.
    expect(audioMseMime("aac", "mp4a.40.5")).toBe(
      'audio/mp4; codecs="mp4a.40.5"',
    );
    expect(audioMseMime("aac", null)).toBe('audio/mp4; codecs="mp4a.40.2"');
    expect(audioMseMime(null, null)).toBeNull();
  });
});
