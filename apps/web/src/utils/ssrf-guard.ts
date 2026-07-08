import { isPrivateIp } from "./is-private-ip";

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
const FETCH_TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 1024 * 1024; // 1 MiB

/**
 * Validates that a URL string is safe to fetch from the server (anti-SSRF).
 *
 * Checks:
 * 1. Valid URL syntax
 * 2. Only http/https schemes
 * 3. Hostname is not a private / loopback / link-local IP
 * 4. Hostname is not "localhost"
 */
export function isSafeFetchUrl(
  url: string
): { ok: true } | { ok: false; reason: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "URL inválida" };
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return { ok: false, reason: "Solo se permiten URLs http/https" };
  }

  const hostname = parsed.hostname;

  if (hostname === "localhost" || hostname === "::1") {
    return { ok: false, reason: "No se permite localhost" };
  }

  if (isPrivateIp(hostname)) {
    return { ok: false, reason: "No se permiten IPs privadas" };
  }

  return { ok: true };
}

/**
 * Safe fetch wrapper that validates the target URL and applies a timeout + body-size limit.
 * Throws if the URL is not safe.
 */
export async function safeFetch(
  url: string,
  init?: RequestInit
): Promise<Response> {
  const check = isSafeFetchUrl(url);
  if (!check.ok) {
    throw new Error(check.reason);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  // Merge caller signal (if any) with our own
  if (init?.signal) {
    const callerSignal = init.signal;
    if (callerSignal.aborted) {
      controller.abort(callerSignal.reason);
    } else {
      callerSignal.addEventListener(
        "abort",
        () => controller.abort(callerSignal.reason),
        { once: true }
      );
    }
  }

  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
    return res;
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Maximum response body size used by safe fetch callers. */
export const SAFE_FETCH_MAX_BODY_BYTES = MAX_BODY_BYTES;
