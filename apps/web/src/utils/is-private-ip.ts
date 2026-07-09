/**
 * Returns `true` when `hostname` resolves to a private / loopback / link-local
 * IPv4 or IPv6 address. Pure string check — no DNS resolution.
 */
export function isPrivateIp(hostname: string): boolean {
  // IPv6 loopback
  if (hostname === "::1" || hostname === "0:0:0:0:0:0:0:1") {
    return true;
  }

  // IPv4-mapped IPv6 loopback
  if (hostname === "::ffff:127.0.0.1" || hostname.startsWith("::ffff:127.")) {
    return true;
  }

  // Normalise: strip leading zeros in each IPv4 octet for reliable comparisons
  const v4 = normalizeIpv4(hostname);

  if (!v4) {
    // Not a plain IPv4 — treat unknown hostnames as safe (DNS will resolve later).
    // We only block addresses we can statically identify as private.
    return false;
  }

  const [a, b] = v4.split(".").map(Number);

  // 127.0.0.0/8 — loopback
  if (a === 127) {
    return true;
  }

  // 10.0.0.0/8 — private
  if (a === 10) {
    return true;
  }

  // 172.16.0.0/12 — private
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }

  // 192.168.0.0/16 — private
  if (a === 192 && b === 168) {
    return true;
  }

  // 169.254.0.0/16 — link-local
  if (a === 169 && b === 254) {
    return true;
  }

  // 0.0.0.0 — unspecified
  if (a === 0) {
    return true;
  }

  return false;
}

/**
 * Normalise a string that looks like an IPv4 address by stripping leading zeros
 * in each octet. Returns `null` if it doesn't match the IPv4 pattern.
 *
 * Examples:
 *   "010.001.002.003" → "10.1.2.3"
 *   "192.168.1.1"     → "192.168.1.1"
 *   "example.com"     → null
 */
const DIGIT_REGEX = /^\d{1,3}$/;

function normalizeIpv4(raw: string): string | null {
  const parts = raw.split(".");
  if (parts.length !== 4) {
    return null;
  }

  const octets: number[] = [];
  for (const part of parts) {
    if (!DIGIT_REGEX.test(part)) {
      return null;
    }
    const n = Number(part);
    if (n < 0 || n > 255) {
      return null;
    }
    octets.push(n);
  }

  return octets.join(".");
}
