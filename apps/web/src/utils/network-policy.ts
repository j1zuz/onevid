/**
 * Host validation for user-supplied outbound URLs on Cloudflare Workers.
 *
 * Workers `fetch` resolves DNS at the edge and does not expose the resolved
 * address, so DNS pinning is not available. This module still rejects literal
 * private/loopback/link-local addresses and reserved hostnames, and the edge
 * network refuses private ranges. Do not weaken these checks: they are the
 * remaining barrier against SSRF.
 */

/** `new URL().hostname` keeps the brackets on IPv6 (`[::1]`). */
export function stripHostBrackets(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, "");
}

function parseV4(value: string): number[] | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    octets.push(octet);
  }
  return octets;
}

function parseV6FirstHextet(value: string): number | null {
  if (!value.includes(":")) return null;
  if (!/^[0-9a-fA-F:.]+$/.test(value)) return null;
  const first = value.startsWith("::")
    ? 0
    : Number.parseInt(value.split(":")[0] ?? "", 16);
  return Number.isNaN(first) ? null : first;
}

export function isIP(value: string): 0 | 4 | 6 {
  if (parseV4(value)) return 4;
  if (parseV6FirstHextet(value) !== null) return 6;
  return 0;
}

const V4_BLOCKED: ReadonlyArray<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
];

function v4ToInt(octets: number[]): number {
  return (
    ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0
  );
}

function inV4Range(ip: number, base: string, prefix: number): boolean {
  const baseParts = parseV4(base);
  if (!baseParts) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ip & mask) === (v4ToInt(baseParts) & mask);
}

/** `true` only for routable public addresses. */
export function isPublicIpAddress(address: string): boolean {
  const v4 = parseV4(address);
  if (v4) {
    const ip = v4ToInt(v4);
    return !V4_BLOCKED.some(([base, prefix]) => inV4Range(ip, base, prefix));
  }

  const first = parseV6FirstHextet(address);
  if (first === null) return false;
  // Global unicast 2000::/3, excluding 2001::/32 (Teredo/benchmark) and
  // 2002::/16 (6to4).
  return first >= 0x2000 && first <= 0x3fff && first !== 0x2001 && first !== 0x2002;
}

export class UnsafeTargetError extends Error {
  constructor(message = "El destino de la solicitud no es accesible.") {
    super(message);
    this.name = "UnsafeTargetError";
  }
}

const RESERVED_HOSTNAMES = new Set([
  "localhost",
  "localhost.",
  "metadata",
  "metadata.google.internal",
  "instance-data",
]);

/**
 * Rejects literal private addresses and reserved names. It cannot resolve
 * hostnames (no DNS on Workers); the platform's egress policy blocks private
 * ranges for the remaining cases.
 */
export function assertPublicHostname(hostname: string): void {
  const bare = stripHostBrackets(hostname).toLowerCase();
  if (!bare) throw new UnsafeTargetError();

  if (
    RESERVED_HOSTNAMES.has(bare) ||
    bare.endsWith(".localhost") ||
    bare.endsWith(".local") ||
    bare.endsWith(".internal")
  ) {
    throw new UnsafeTargetError();
  }

  if (isIP(bare) !== 0 && !isPublicIpAddress(bare)) {
    throw new UnsafeTargetError();
  }
}
