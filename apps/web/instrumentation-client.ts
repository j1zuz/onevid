import posthog from "posthog-js";
import type { CaptureResult } from "posthog-js";

// Messages a `fetch` rejection carries when the request is torn down rather than
// failing for real — a dropped connection, or a request still in flight when we
// unmount the player. mediabunny's `UrlSource` fires these Range reads deep
// inside the library (see use-mediabunny.ts), so an unmount-time failure escapes
// to `unhandledrejection` as a bare, stack-less error. A genuine playback
// failure is re-thrown by that hook as an `Error` with a real message and stack,
// so it never matches the shape below.
const ABORT_FETCH_MESSAGES = [
  "NetworkError when attempting to fetch resource", // Firefox
  "Failed to fetch", // Chromium
  "Load failed", // Safari
  "The network connection was lost", // Safari
  "The operation was aborted", // AbortError
];

function isAbortShapedFetchException(exception: {
  type?: string;
  value?: string;
  stacktrace?: { frames?: unknown[] };
}): boolean {
  const type = exception.type ?? "";
  const value = exception.value ?? "";
  const frames = exception.stacktrace?.frames;
  const hasStack = Array.isArray(frames) && frames.length > 0;
  const abortShaped =
    type === "AbortError" ||
    (type === "TypeError" &&
      ABORT_FETCH_MESSAGES.some((message) => value.includes(message)));
  // Only drop the bare, stack-less rejections. Anything carrying frames — every
  // real playback error — is left to report as usual.
  return abortShaped && !hasStack;
}

// A crash on a developer's machine is dev noise, not a production defect. Each
// dev rebuild also carries a fresh Turbopack chunk name in the stack, so the
// same crash splits into a new issue every time. Keep exception capture off for
// any loopback host so local crashes never reach the production project.
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);
const isLocalHost =
  typeof window !== "undefined" && LOCAL_HOSTS.has(window.location.hostname);

posthog.init(process.env.NEXT_PUBLIC_POSTHOG_TOKEN as string, {
  api_host: "/ingest",
  ui_host: "https://us.posthog.com",
  defaults: "2026-01-30",
  capture_exceptions: !isLocalHost,
  debug: process.env.NODE_ENV === "development",
  disable_surveys: true,
  disable_conversations: true,
  opt_out_capturing_by_default: true,
  opt_out_persistence_by_default: true,
  before_send: (event: CaptureResult | null) => {
    if (event?.event === "$exception") {
      const list = event.properties?.$exception_list;
      if (
        Array.isArray(list) &&
        list.length > 0 &&
        list.every(isAbortShapedFetchException)
      ) {
        return null;
      }
    }
    return event;
  },
});
// Surveys are disabled permanently — we have our own custom feedback popover in
// the sidebar dropdown. The Support (conversations) chat widget is disabled at
// init and re-enabled at runtime in <PaidUserSupportWidget /> for users with
// an active subscription.
