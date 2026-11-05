import http from "node:http";
import type { IncomingHttpHeaders } from "node:http";
import https from "node:https";
import type { RequestOptions } from "node:https";
import { isIP, type TcpSocketConnectOpts } from "node:net";
import {
  createBrotliDecompress,
  createGunzip,
  createInflate,
} from "node:zlib";
import {
  isPublicIpAddress,
  resolvePublicHost,
  stripHostBrackets,
} from "./network-policy";

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
const FETCH_TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 1024 * 1024; // 1 MiB
const MAX_REDIRECTS = 5;
const MAX_HEADER_BYTES = 16 * 1024;

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
  return new SafeFetchError("invalid-url", "La URL del complemento no es válida.");
}

/**
 * Valida de forma SINCRONA que un string sea una URL http(s) sin credenciales
 * y que su host no sea un literal privado. NO resuelve DNS: para la decision
 * de conexion usa `safeFetch`, que resuelve y fija la direccion real.
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
  // origenes con secretos: siempre se rechazan.
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
  /** Tiempo maximo total, incluyendo conexion, cabeceras y cuerpo. */
  timeoutMs?: number;
  /** Tope de bytes del cuerpo de respuesta (se aborta al superarlo). */
  maxBodyBytes?: number;
  /** Tope de redirects seguidos, revalidando cada destino. */
  maxRedirects?: number;
}

interface SafeFetchContext {
  maxBodyBytes: number;
  maxRedirects: number;
  signal: AbortSignal;
}

interface RawResponse {
  body: Buffer | null;
  headers: IncomingHttpHeaders;
  status: number;
}

function headerRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((value, name) => {
    record[name] = value;
  });
  return record;
}

async function encodeBody(
  body: BodyInit | null | undefined,
  headers: Headers
): Promise<Buffer | undefined> {
  if (body === null || body === undefined) return undefined;
  if (typeof body === "string") return Buffer.from(body, "utf8");

  if (body instanceof URLSearchParams) {
    if (!headers.has("content-type")) {
      headers.set(
        "content-type",
        "application/x-www-form-urlencoded;charset=UTF-8"
      );
    }
    return Buffer.from(body.toString(), "utf8");
  }

  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (ArrayBuffer.isView(body)) {
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  }

  if (typeof FormData !== "undefined" && body instanceof FormData) {
    // Deja que undici serialice el multipart (incluido el boundary) y reutiliza
    // sus cabeceras; solo se envia el cuerpo resultante.
    const serialized = new Request("http://placeholder.invalid/", {
      method: "POST",
      body,
      headers,
    });
    const contentType = serialized.headers.get("content-type");
    if (contentType) headers.set("content-type", contentType);
    return Buffer.from(await serialized.arrayBuffer());
  }

  if (typeof Blob !== "undefined" && body instanceof Blob) {
    if (!headers.has("content-type") && body.type) {
      headers.set("content-type", body.type);
    }
    return Buffer.from(await body.arrayBuffer());
  }

  throw invalidUrl();
}

/** Convierte la respuesta cruda de node:http en un `Response` estandar. */
function toResponse({
  body,
  headers: rawHeaders,
  status,
}: RawResponse): Response {
  const headers = new Headers();
  for (const [name, value] of Object.entries(rawHeaders)) {
    if (value === undefined) continue;
    // Frames de conexion y longitud vieja no aplican al Response reconstruido.
    if (
      name === "connection" ||
      name === "keep-alive" ||
      name === "transfer-encoding" ||
      name === "content-length" ||
      name === "content-encoding"
    ) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else {
      headers.set(name, value);
    }
  }

  const nullBody =
    body === null || status === 204 || status === 205 || status === 304;
  return new Response(nullBody ? null : (body as unknown as BodyInit), {
    status,
    headers,
  });
}

/**
 * Una peticion HTTP(S) con la conexion fijada al IP ya validado. Nunca deja
 * que el resolver del sistema vuelva a resolver el host.
 */
function sendPinned(
  target: URL,
  pinned: { address: string; family: number },
  method: string,
  headers: Headers,
  payload: Buffer | undefined,
  context: SafeFetchContext
): Promise<RawResponse> {
  const isHttps = target.protocol === "https:";
  const transport = isHttps ? https : http;
  const hostname = stripHostBrackets(target.hostname);

  const outgoing = headerRecord(headers);
  outgoing.host = target.host;
  // Sin compresion: el cuerpo se reconstruye tal cual y no se descomprime.
  outgoing["accept-encoding"] = "identity";
  if (payload) outgoing["content-length"] = String(payload.byteLength);

  const options: RequestOptions &
    Pick<TcpSocketConnectOpts, "autoSelectFamily"> = {
    method,
    protocol: target.protocol,
    hostname,
    port: target.port ? Number(target.port) : undefined,
    path: `${target.pathname}${target.search}`,
    headers: outgoing,
    agent: false,
    family: pinned.family,
    autoSelectFamily: false,
    // Host/SNI y verificacion de certificado siguen siendo los del hostname.
    servername: isHttps && isIP(hostname) === 0 ? hostname : undefined,
    rejectUnauthorized: isHttps,
    maxHeaderSize: MAX_HEADER_BYTES,
    lookup: (_host, lookupOptions, callback) => {
      if (lookupOptions.all) callback(null, [pinned]);
      else callback(null, pinned.address, pinned.family);
    },
  };

  return new Promise((resolve, reject) => {
    let settled = false;

    const finish = (error: Error | null, result?: RawResponse) => {
      if (settled) return;
      settled = true;
      context.signal.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else if (result) resolve(result);
      else
        reject(
          new SafeFetchError("network", "No se pudo completar la solicitud.")
        );
    };

    const onAbort = () => {
      request.destroy();
      finish(
        new SafeFetchError("timeout", "El servidor del complemento tardó demasiado.")
      );
    };

    const request = transport.request(options, (incoming) => {
      const status = incoming.statusCode ?? 0;

      // Los 3xx se devuelven sin leer el cuerpo: el llamador decide si seguir.
      if (status >= 300 && status < 400) {
        incoming.resume();
        finish(null, { body: null, headers: incoming.headers, status });
        return;
      }

      if (status < 200 || status > 599) {
        incoming.resume();
        finish(
          new SafeFetchError("network", "No se pudo completar la solicitud.")
        );
        return;
      }

      const chunks: Buffer[] = [];
      let size = 0;

      // Aunque pedimos `identity`, algunos servidores ignoran la cabecera y
      // responden comprimido. Se descomprime en streaming y el tope de bytes
      // se aplica al contenido ya descomprimido.
      const encoding = String(incoming.headers["content-encoding"] ?? "")
        .toLowerCase()
        .trim();
      const bodyStream: NodeJS.ReadableStream =
        encoding === "gzip" || encoding === "x-gzip"
          ? incoming.pipe(createGunzip())
          : encoding === "deflate"
            ? incoming.pipe(createInflate())
            : encoding === "br"
              ? incoming.pipe(createBrotliDecompress())
              : incoming;

      bodyStream.on("data", (chunk: Buffer) => {
        if (settled) return;
        size += chunk.byteLength;
        if (size > context.maxBodyBytes) {
          incoming.destroy();
          finish(
            new SafeFetchError(
              "too-large",
              "La respuesta del complemento es demasiado grande."
            )
          );
          return;
        }
        chunks.push(chunk);
      });
      bodyStream.once("end", () => {
        finish(null, {
          body: Buffer.concat(chunks),
          headers: incoming.headers,
          status,
        });
      });
      bodyStream.once("error", () => {
        finish(
          new SafeFetchError("network", "No se pudo completar la solicitud.")
        );
      });
      incoming.once("error", () => {
        finish(
          new SafeFetchError("network", "No se pudo completar la solicitud.")
        );
      });
    });

    request.once("error", () => {
      finish(
        new SafeFetchError("network", "No se pudo completar la solicitud.")
      );
    });

    if (context.signal.aborted) onAbort();
    else {
      context.signal.addEventListener("abort", onAbort, { once: true });
      if (payload) request.write(payload);
      request.end();
    }
  });
}

async function runSafeFetch(
  input: string,
  init: RequestInit | undefined,
  context: SafeFetchContext
): Promise<Response> {
  const headers = new Headers(init?.headers);
  let payload = await encodeBody(init?.body, headers);
  let method = (init?.method ?? "GET").toUpperCase();
  const manualRedirect = init?.redirect === "manual";
  let current = input;

  for (let hop = 0; hop <= context.maxRedirects; hop++) {
    if (!isSafeFetchUrl(current).ok) throw invalidUrl();

    const target = new URL(current);
    // Resuelve y valida TODAS las direcciones antes de conectar. `sendPinned`
    // fija la conexion a la primera y no permite una segunda resolucion.
    const addresses = await resolvePublicHost(target.hostname);
    const response = await sendPinned(
      target,
      addresses[0],
      method,
      headers,
      payload,
      context
    );

    const isRedirect = response.status >= 300 && response.status < 400;
    const location = response.headers.location;

    if (!isRedirect || !location || manualRedirect) {
      return toResponse(response);
    }

    const next = new URL(location, target);
    if (!ALLOWED_PROTOCOLS.has(next.protocol)) throw invalidUrl();
    current = next.toString();

    // 301/302 con cuerpo pasan a GET; 303 siempre (salvo HEAD); 307/308
    // conservan metodo y cuerpo.
    if (
      method !== "HEAD" &&
      (response.status === 303 ||
        ((response.status === 301 || response.status === 302) &&
          method !== "GET"))
    ) {
      method = "GET";
      payload = undefined;
      headers.delete("content-type");
    }
  }

  throw new SafeFetchError(
    "blocked-target",
    "El servidor del complemento redirige demasiadas veces."
  );
}

/**
 * Fetch anti-SSRF: resuelve DNS, exige direcciones publicas, fija la conexion a
 * la IP validada, sigue redirects revalidando cada salto, aplica timeout total
 * y limita el tamano del cuerpo.
 */
export async function safeFetch(
  url: string,
  init?: RequestInit,
  options?: SafeFetchOptions
): Promise<Response> {
  const timeoutMs = options?.timeoutMs ?? FETCH_TIMEOUT_MS;
  const controller = new AbortController();
  const context: SafeFetchContext = {
    maxBodyBytes: options?.maxBodyBytes ?? MAX_BODY_BYTES,
    maxRedirects: options?.maxRedirects ?? MAX_REDIRECTS,
    signal: controller.signal,
  };

  const onCallerAbort = () => controller.abort();
  if (init?.signal) {
    if (init.signal.aborted) controller.abort();
    else init.signal.addEventListener("abort", onCallerAbort, { once: true });
  }

  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await runSafeFetch(url, init, context);
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

/** Maximo de cuerpo por defecto para los llamadores que necesitan reutilizarlo. */
export const SAFE_FETCH_MAX_BODY_BYTES = MAX_BODY_BYTES;
