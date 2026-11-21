// Cookie con el perfil activo. Vive en un módulo aparte (y no en el contexto de
// perfiles) para que hooks y páginas sueltas puedan leerla sin arrastrar el
// provider entero, p. ej. el reproductor sin conexión, que debe abrir sin red.
export const ACTIVE_PROFILE_COOKIE = "onevid-active-profile";

/**
 * Lee el perfil activo de la cookie que escribe OneVidProfileProvider. Se lee de
 * la cookie (y no del contexto) porque la ruta del player no monta el provider;
 * la cookie es global, así que está disponible igual.
 */
export function readActiveProfileId(): string | null {
  if (typeof document === "undefined") {
    return null;
  }
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${ACTIVE_PROFILE_COOKIE}=([^;]*)`)
  );
  if (!match) {
    return null;
  }
  try {
    return decodeURIComponent(match[1]) || null;
  } catch {
    return match[1] || null;
  }
}
