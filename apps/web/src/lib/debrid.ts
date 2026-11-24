/**
 * Abstracción mínima sobre los proveedores debrid que OneVid soporta.
 *
 * Cada proveedor tiene su propio cliente (`lib/torbox.ts`, `lib/real-debrid.ts`)
 * porque las APIs no se parecen: TorBox usa `createtorrent` + `requestdl` y
 * Real-Debrid usa `addMagnet` + `unrestrict/link`. Lo que SÍ se comparte es la
 * forma del resultado y la elección del proveedor activo, que es lo que vive
 * acá. Este módulo lo importan componentes cliente, así que no debe importar
 * nada de `node:` ni tocar la base de datos.
 */

import { magnetInfoHash } from "@/lib/magnet";

export type DebridProvider = "torbox" | "realdebrid";

export const DEBRID_PROVIDER_NAMES: Record<DebridProvider, string> = {
  realdebrid: "Real-Debrid",
  torbox: "TorBox",
};

/** Estado que viaja a la UI: qué keys existen y cuál resuelve los magnets. */
export interface DebridStatus {
  hasRealDebrid: boolean;
  hasTorbox: boolean;
  provider: DebridProvider;
}

export interface ResolvedDebridStream {
  fileName?: string;
  fileSize?: number;
  url: string;
}

/**
 * Resultado de resolver un magnet. `preparing` significa que el torrent ya está
 * en la cuenta pero el debrid todavía no terminó de bajarlo: no es un error,
 * hay que esperar en vez de devolver un 502 que el usuario lee como "fuente
 * rota".
 */
export type DebridStreamResult =
  | { progress: number | null; state: string | null; status: "preparing" }
  | { status: "ready"; stream: ResolvedDebridStream }
  | {
      status: "unavailable";
      /**
       * Motivo legible cuando el proveedor rechazó la petición (p. ej. la API
       * key expiró). Sin esto el player solo ve un 502 y lo muestra como
       * "fuente rota", que manda al usuario a buscar el problema donde no está.
       */
      reason?: string;
    };

export function normalizeDebridProvider(
  value: unknown
): DebridProvider | null {
  return value === "torbox" || value === "realdebrid" ? value : null;
}

/**
 * Proveedor que debe resolver los magnets de un usuario.
 *
 * La preferencia guardada manda solo si ese proveedor tiene key; si no, se usa
 * el que sí la tenga. Mantener TorBox como fallback conserva el comportamiento
 * de las cuentas que ya lo tenían configurado antes de existir Real-Debrid.
 */
export function resolveActiveDebridProvider(input: {
  preferred?: string | null;
  hasTorbox: boolean;
  hasRealDebrid: boolean;
}): DebridProvider {
  const preferred = normalizeDebridProvider(input.preferred);
  if (preferred === "realdebrid" && input.hasRealDebrid) {
    return "realdebrid";
  }
  if (preferred === "torbox" && input.hasTorbox) {
    return "torbox";
  }
  if (input.hasTorbox) {
    return "torbox";
  }
  if (input.hasRealDebrid) {
    return "realdebrid";
  }
  return preferred ?? "torbox";
}

/** Ruta del endpoint que resuelve magnets para el proveedor indicado. */
export function debridResolvePath(provider: DebridProvider): string {
  return provider === "realdebrid"
    ? "/api/real-debrid/resolve"
    : "/api/torbox/resolve";
}

/**
 * Reescribe un magnet a nuestro endpoint de resolución. Devuelve `null` si la
 * URL no es un magnet (el resto de fuentes se deja intacta).
 */
export function buildDebridResolveUrl(
  provider: DebridProvider,
  magnet: string
): string | null {
  if (!magnet.startsWith("magnet:")) {
    return null;
  }
  const hash = magnetInfoHash(magnet) ?? "";
  return `${debridResolvePath(provider)}?hash=${encodeURIComponent(
    hash
  )}&magnet=${encodeURIComponent(magnet)}`;
}
