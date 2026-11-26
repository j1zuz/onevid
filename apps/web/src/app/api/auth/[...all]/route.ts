import { toNextJsHandler } from "better-auth/next-js";
import { createHash } from "node:crypto";
import { auth } from "../../../../lib/auth";
import { checkRateLimitDb } from "@/lib/rate-limit-db";
import { rateLimitResponse } from "@/lib/rate-limit";

const handler = toNextJsHandler(auth.handler);

export const GET = handler.GET;

function clientIp(request: Request): string {
  const raw =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for") ??
    "";
  return raw.split(",")[0]?.trim() || "unknown";
}

async function readEmail(request: Request): Promise<string> {
  try {
    const body = (await request.clone().json()) as { email?: unknown };
    return typeof body.email === "string"
      ? body.email.trim().toLowerCase()
      : "";
  } catch {
    return "";
  }
}

/**
 * Better Auth ya aplica sus reglas, pero son por isolate. Antes de dejar pasar
 * el magic-link (email pagado a una dirección elegida por el llamante) y el
 * device-code (filas nuevas sin sesión), aplicamos un presupuesto compartido
 * en Postgres por IP y, para magic-link, por destinatario.
 */
export async function POST(request: Request): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  const ip = clientIp(request);

  if (pathname.endsWith("/sign-in/magic-link")) {
    // Tope global del despliegue: evita que un ataque distribuido (muchas IPs)
    // convierta el Worker en un grifo de email. Es alto para no bloquear uso
    // normal; el challenge de borde sigue siendo la capa recomendada.
    const globalLimit = await checkRateLimitDb(
      "auth-magic-global",
      500,
      3600_000
    );
    if (!globalLimit.ok) return rateLimitResponse(globalLimit.retryAfter);

    const ipLimit = await checkRateLimitDb(`auth-magic-ip:${ip}`, 20, 3600_000);
    if (!ipLimit.ok) return rateLimitResponse(ipLimit.retryAfter);

    const email = await readEmail(request);
    if (email) {
      // No guardamos el email del destinatario en la tabla de rate limit.
      const emailKey = createHash("sha256")
        .update(email, "utf8")
        .digest("base64url")
        .slice(0, 32);
      const emailLimit = await checkRateLimitDb(
        `auth-magic-email:${emailKey}`,
        3,
        3600_000
      );
      if (!emailLimit.ok) return rateLimitResponse(emailLimit.retryAfter);
    }
  } else if (pathname.endsWith("/device/code")) {
    const limit = await checkRateLimitDb(`auth-device-code:${ip}`, 60, 3600_000);
    if (!limit.ok) return rateLimitResponse(limit.retryAfter);
  }

  // El flujo de dispositivo lo usan clientes nativos, que no mandan `Origin`.
  // Si el almacén de cookies del sistema conserva una sesión vieja (p. ej. la
  // que dejó el WebView de Configuración), Better Auth ve una cookie, exige un
  // Origin para protegerse de CSRF y responde 403 MISSING_OR_NULL_ORIGIN: el
  // login por código fallaba solo en los dispositivos con esa cookie. Estos
  // dos endpoints no autentican por cookie (devuelven/leen un Bearer), así que
  // se les quita la cookie antes de llegar a Better Auth.
  if (
    pathname.endsWith("/device/code") ||
    pathname.endsWith("/device/token")
  ) {
    // Clonar con `new Request(request, …)` no vale en Workers con cuerpo:
    // se reconstruye con la URL, el método y el texto ya leído.
    const body = await request.text();
    const headers = new Headers(request.headers);
    headers.delete("cookie");
    headers.delete("content-length");
    return handler.POST(
      new Request(request.url, { body, headers, method: request.method })
    );
  }

  return handler.POST(request);
}
