import {
  assertPublicHostname,
  isIP,
  isPublicIpAddress,
  stripHostBrackets,
} from "./network-policy";

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
const FETCH_TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 1024 * 1024; // 1 MiB
const MAX_REDIRECTS = 5;

export type SafeFetchErrorCode =
  | "invalid-url"
  | "blocked-target"
  | "timeout"
  | "too-large"
  | "network";

/**
 * Error de `safeFetch` con un mensaje apto para devolver al cliente: nunca
 * incluye la URL, el host resuelto ni detalles de red internos.
 */
export class SafeFetchError extends Error {
  readonly code: SafeFetchErrorCode;

  constructor(code: SafeFetchErrorCode, message: string) {
    super(message);
    this.name = "SafeFetchError";
    this.code = code;
  }
}

function invalidUrl(): SafeFetchError {
  return new SafeFetchError(
    "invalid-url",
    "La URL del complemento no es válida."
  );
}

/**
 * Valida de forma SÍNCRONA que un string sea una URL http(s) sin credenciales
 * y que su host no sea un literal privado. No resuelve DNS (Workers no lo
 * expone); los literales privados y nombres reservados se rechazan aquí.
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

  // Las credenciales en la URL no aportan nada y fuerzan redirects entre
  // orígenes con secretos: siempre se rechazan.
  if (parsed.username || parsed.password) {
    return { ok: false, reason: "No se admiten credenciales en la URL" };
  }

  const hostname = stripHostBrackets(parsed.hostname);

  if (hostname === "localhost" || hostname.toLowerCase() === "localhost.") {
    return { ok: false, reason: "No se permite localhost" };
  }

  if (isIP(hostname) !== 0 && !isPublicIpAddress(hostname)) {
    return { ok: false, reason: "No se permiten direcciones privadas" };
  }

  return { ok: true };
}

export interface SafeFetchOptions {
  /** Tiempo máximo total, incluyendo conexión, cabeceras y cuerpo. */
  timeoutMs?: number;
  /** Tope de bytes del cuerpo de respuesta (se aborta al superarlo). */
  maxBodyBytes?: number;
  /** Tope de redirects seguidos, revalidando cada destino. */
  maxRedirects?: number;
}

async function readBoundedBody(
  response: Response,
  maxBodyBytes: number
): Promise<Response> {
  if (!response.body) {
    return response;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBodyBytes) {
        await reader.cancel().catch(() => undefined);
        throw new SafeFetchError(
          "too-large",
          "La respuesta del complemento es demasiado grande."
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new Response(body, {
    status: response.status,
    headers: response.headers,
  });
}

/**
 * Fetch anti-SSRF para Workers: valida protocolo/host en cada salto, sigue
 * redirects manualmente, aplica timeout total y limita el tamaño del cuerpo.
 * No puede fijar la IP resuelta (Workers no expone DNS); los literales privados
 * y nombres reservados se rechazan y la red del edge bloquea rangos privados.
 */
export async function safeFetch(
  url: string,
  init?: RequestInit,
  options?: SafeFetchOptions
): Promise<Response> {
  const timeoutMs = options?.timeoutMs ?? FETCH_TIMEOUT_MS;
  const maxBodyBytes = options?.maxBodyBytes ?? MAX_BODY_BYTES;
  const maxRedirects = options?.maxRedirects ?? MAX_REDIRECTS;

  const controller = new AbortController();
  const onCallerAbort = () => controller.abort();
  if (init?.signal) {
    if (init.signal.aborted) {
      controller.abort();
    } else {
      init.signal.addEventListener("abort", onCallerAbort, { once: true });
    }
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const headers = new Headers(init?.headers);
  let method = (init?.method ?? "GET").toUpperCase();
  let body = init?.body ?? undefined;
  const manualRedirect = init?.redirect === "manual";
  let current = url;

  try {
    for (let hop = 0; hop <= maxRedirects; hop++) {
      const check = isSafeFetchUrl(current);
      if (!check.ok) {
        throw new SafeFetchError("blocked-target", check.reason);
      }
      try {
        assertPublicHostname(new URL(current).hostname);
      } catch {
        throw new SafeFetchError(
          "blocked-target",
          "No se permiten direcciones privadas"
        );
      }

      const response = await fetch(current, {
        body,
        headers,
        method,
        redirect: "manual",
        signal: controller.signal,
      });

      const location = response.headers.get("location");
      const isRedirect = response.status >= 300 && response.status < 400;

      if (!isRedirect || !location || manualRedirect) {
        return await readBoundedBody(response, maxBodyBytes);
      }

      const next = new URL(location, current);
      if (!ALLOWED_PROTOCOLS.has(next.protocol)) {
        throw invalidUrl();
      }
      current = next.toString();

      // 301/302 con cuerpo pasan a GET; 303 siempre (salvo HEAD); 307/308
      // conservan método y cuerpo.
      if (
        method !== "HEAD" &&
        (response.status === 303 ||
          ((response.status === 301 || response.status === 302) &&
            method !== "GET"))
      ) {
        method = "GET";
        body = undefined;
        headers.delete("content-type");
      }
    }

    throw new SafeFetchError(
      "blocked-target",
      "El servidor del complemento redirige demasiadas veces."
    );
  } catch (error) {
    if (error instanceof SafeFetchError) throw error;
    if (controller.signal.aborted) {
      throw new SafeFetchError(
        "timeout",
        "El servidor del complemento tardó demasiado."
      );
    }
    throw new SafeFetchError("network", "No se pudo completar la solicitud.");
  } finally {
    clearTimeout(timer);
    init?.signal?.removeEventListener("abort", onCallerAbort);
  }
}

/** Máximo de cuerpo por defecto para los llamadores que necesitan reutilizarlo. */
export const SAFE_FETCH_MAX_BODY_BYTES = MAX_BODY_BYTES;
