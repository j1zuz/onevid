import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement, type ReactNode } from "react";
// @ts-expect-error -- Bun provides the runtime test mocking API; Bun types are not installed.
import { mock } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
// Isolate workspace UI (and its browser-only drawer) without mocking the shared
// renderer or Video.js skin. This also avoids broken local workspace dependency links.
const passthrough = ({ children }: { children?: ReactNode }) => children;
mock.module("@workspace/ui/lib/utils", () => ({
  cn: (...values: unknown[]) => values.filter(Boolean).join(" "),
}));
mock.module("@workspace/ui/components/alert", () => ({
  Alert: ({ children }: { children?: ReactNode }) =>
    createElement("div", { "data-slot": "alert", role: "alert" }, children),
  AlertTitle: passthrough,
  AlertDescription: passthrough,
}));
mock.module("@workspace/ui/components/button", () => ({ Button: passthrough }));
mock.module("@workspace/ui/components/tooltip", () => ({
  Tooltip: passthrough,
  TooltipTrigger: passthrough,
  TooltipContent: passthrough,
}));
mock.module("./stream-track-picker", () => ({ StreamTrackPicker: () => null }));
const {
  getLiveEdge,
  isLiveTvPlaybackUrl,
  LIVE_TV_BUFFERING_TIMEOUT_MS,
  LIVE_TV_STARTUP_TIMEOUT_MS,
  LiveTvPlayer,
  returnToLive,
} = await import("./live-tv-player");
const { VideoJsStreamPlayer } = await import("./video-js-stream-player");
const { OnevidI18nProvider } = await import("../../lib/onevid-i18n-context");

function renderPlayer(
  channel: Parameters<typeof LiveTvPlayer>[0]["channel"],
): string {
  return renderToStaticMarkup(
    createElement(OnevidI18nProvider, {
      initialLocale: "es-419",
      children: createElement(LiveTvPlayer, { channel }),
    }),
  );
}

function seekable(ranges: [number, number][]): TimeRanges {
  return {
    length: ranges.length,
    start: (index) => ranges[index][0],
    end: (index) => ranges[index][1],
  };
}

describe("shared Live TV player", () => {
  it("requires HTTPS without embedded credentials", () => {
    assert.equal(
      isLiveTvPlaybackUrl("https://provider.example/live.m3u8?token=private"),
      true,
    );
    for (const url of [
      "http://provider.example/live.m3u8",
      "https://user:secret@provider.example/live.m3u8",
      "javascript:alert(1)",
      "invalid",
      "/relative.m3u8",
    ]) {
      assert.equal(isLiveTvPlaybackUrl(url), false);
    }
  });

  it("uses the final seekable range and avoids its exact end", () => {
    assert.equal(
      getLiveEdge({
        seekable: seekable([
          [0, 5],
          [20, 40],
        ]),
      }),
      39.5,
    );
    assert.equal(getLiveEdge({ seekable: seekable([[20, 20.2]]) }), 20);
    assert.equal(getLiveEdge(null), null);
    assert.equal(getLiveEdge({ seekable: seekable([]) }), null);
    assert.equal(getLiveEdge({ seekable: seekable([[10, 10]]) }), null);
    assert.equal(getLiveEdge({ seekable: seekable([[10, Infinity]]) }), null);
  });

  it("seeks to live at normal speed and tolerates autoplay rejection", async () => {
    let played = false;
    const video = {
      seekable: seekable([[30, 60]]),
      currentTime: 30,
      playbackRate: 2,
      play: () => {
        played = true;
        return Promise.reject(new Error("Autoplay blocked"));
      },
    };
    assert.equal(returnToLive(video as unknown as HTMLVideoElement), true);
    assert.equal(video.currentTime, 59.5);
    assert.equal(video.playbackRate, 1);
    assert.equal(played, true);
    await Promise.resolve();
    assert.equal(returnToLive(null), false);
  });

  it("does not seek or play before a live window is available", () => {
    const video = {
      seekable: seekable([]),
      currentTime: 10,
      play: () => {
        throw new Error("Must not play");
      },
    };
    assert.equal(returnToLive(video as unknown as HTMLVideoElement), false);
    assert.equal(video.currentTime, 10);
  });

  it("fails a channel that never starts instead of loading forever", () => {
    assert.equal(LIVE_TV_STARTUP_TIMEOUT_MS, 60_000);
    // A channel that already played gets a shorter grace period when it stalls.
    assert.equal(LIVE_TV_BUFFERING_TIMEOUT_MS, 30_000);
    assert.ok(LIVE_TV_BUFFERING_TIMEOUT_MS < LIVE_TV_STARTUP_TIMEOUT_MS);
  });

  it("keeps movie mode as the shared renderer default and opts in to a fullscreen-contained live toolbar", () => {
    const props = {
      src: "https://provider.example/live.m3u8",
      mimeType: "application/x-mpegURL" as const,
      liveControls: createElement(
        "div",
        { "data-test-live-toolbar": true },
        "Live toolbar",
      ),
    };
    const movie = renderToStaticMarkup(
      createElement(VideoJsStreamPlayer, props),
    );
    const live = renderToStaticMarkup(
      createElement(VideoJsStreamPlayer, { ...props, liveMode: true }),
    );
    assert.doesNotMatch(movie, /live-mode|data-test-live-toolbar/);
    assert.match(live, /live-mode/);
    assert.match(live, /video-skin/);
    assert.match(live, /data-test-live-toolbar/);
    assert.ok(
      live.indexOf("video-skin") < live.indexOf("data-test-live-toolbar"),
    );
  });

  it("shows the channel logo as the pre-playback loader and falls back to the initial", () => {
    const html = renderPlayer({
      id: "channel",
      name: "News",
      group: "News",
      url: "https://provider.example/live.m3u8",
      logo: "https://provider.example/logo.png",
    });
    assert.match(html, /role="status"/);
    assert.match(html, /Cargando News/);
    assert.match(html, /provider\.example\/logo\.png/);

    const fallback = renderPlayer({
      id: "channel",
      name: "News",
      group: "News",
      url: "https://provider.example/live.m3u8",
      logo: "http://provider.example/insecure.png",
    });
    assert.doesNotMatch(fallback, /insecure\.png/);
    assert.match(fallback, />N</);
  });

  it("rejects unsafe sources with shared Alert UI and never prints their credentials", () => {
    const html = renderPlayer({
      id: "channel",
      name: "News",
      group: "News",
      url: "https://private-user:private-password@provider.example/live.m3u8",
    });
    assert.match(html, /data-slot="alert"/);
    assert.match(html, /HTTPS/);
    assert.doesNotMatch(
      html,
      /private-user|private-password|provider\.example/,
    );
  });
});
