/**
 * Detección de "cliente TV" (LG webOS / Samsung Tizen y navegadores de Smart TV
 * en general). La misma web de onevid se sirve a las TVs; cuando el cliente es
 * una TV, el login no puede pedir email/contraseña (no se puede escribir con el
 * mando), así que `/` muestra el flujo de código de dispositivo en su lugar.
 *
 * `?tv=1` fuerza el modo TV para poder probarlo en el navegador de escritorio.
 */
const TV_USER_AGENT = /webos|web0s|tizen|smart-?tv|netcast|hbbtv|appletv|crkey/i;

export function isTvUserAgent(ua: string | null | undefined): boolean {
  return Boolean(ua && TV_USER_AGENT.test(ua));
}
