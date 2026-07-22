// `fetch` con timeout vía AbortController. React Native `fetch` no tiene timeout
// propio: en una red móvil inestable una petición puede quedarse colgada
// indefinidamente, dejando la promesa pendiente para siempre. En el arranque eso
// significa quedarse en el splash negro sin spinner, error ni salida. Al vencer
// el timeout abortamos y `fetch` rechaza con AbortError, que las llamadas tratan
// como un fallo de red normal (ver api.ts / auth.ts).
export const DEFAULT_TIMEOUT_MS = 15_000;

export async function fetchWithTimeout(
  input: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
