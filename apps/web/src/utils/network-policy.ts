import dns from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { BlockList, isIP } from "node:net";

/**
 * Politica de red compartida para cualquier peticion saliente que el servidor
 * haga a un host elegido por el usuario (addons, debrid, listas de Live TV).
 *
 * Un nombre de host NO es de confianza solo porque no parezca una IP privada:
 * `localtest.me`, `metadata.google.internal` o un dominio con DNS rebinding
 * resuelven a loopback/link-local. Por eso toda conexion debe resolver primero
 * y validar la direccion real.
 */

const blocked = new BlockList();
for (const [address, prefix] of [
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
] as const)
  blocked.addSubnet(address, prefix, "ipv4");

// Solo se consideran publicas las IPv6 de unicast global (2000::/3), excluyendo
// los rangos especiales que no deben alcanzarse desde el servidor.
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
blocked.addSubnet("2001::", 32, "ipv6");
blocked.addSubnet("2001:db8::", 32, "ipv6");
blocked.addSubnet("2002::", 16, "ipv6");

/** `new URL().hostname` conserva los corchetes en IPv6 (`[::1]`). */
export function stripHostBrackets(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, "");
}

/** Devuelve `true` solo para direcciones IP publicas enroutables. */
export function isPublicIpAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, "ipv4");
  return (
    family === 6 &&
    globalV6.check(address, "ipv6") &&
    !blocked.check(address, "ipv6")
  );
}

export class UnsafeTargetError extends Error {
  constructor(message = "El destino de la solicitud no es accesible.") {
    super(message);
    this.name = "UnsafeTargetError";
  }
}

/** Tope de espera para la resolucion DNS; un resolver colgado no debe colgar la ruta. */
const DNS_TIMEOUT_MS = 5_000;

async function lookupAll(hostname: string): Promise<LookupAddress[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      dns.lookup(hostname, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new UnsafeTargetError()),
          DNS_TIMEOUT_MS,
        );
      }),
    ]);
  } catch {
    throw new UnsafeTargetError();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resuelve el host y exige que TODAS sus direcciones sean publicas.
 * Devuelve la lista para que el llamador fije la conexion a una de ellas y no
 * vuelva a resolver (evita el rebinding entre validacion y conexion).
 */
export async function resolvePublicHost(
  hostname: string,
): Promise<LookupAddress[]> {
  const bare = stripHostBrackets(hostname);
  const family = isIP(bare);
  const addresses: LookupAddress[] = family
    ? [{ address: bare, family }]
    : await lookupAll(bare);

  if (!addresses.length) throw new UnsafeTargetError();
  for (const { address } of addresses) {
    if (!isPublicIpAddress(address)) throw new UnsafeTargetError();
  }
  return addresses;
}
