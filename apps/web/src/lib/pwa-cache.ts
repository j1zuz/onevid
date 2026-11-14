/**
 * Limpieza de la caché de páginas del service worker.
 *
 * El SW cachea las navegaciones para que la PWA abra sin internet, pero esas
 * respuestas llevan datos del usuario (perfiles, "Continuar viendo", correo en
 * Configuración). Sin este borrado, al cerrar sesión o cambiar de perfil en un
 * dispositivo compartido, una navegación offline podría servir la página del
 * usuario/perfil anterior. El shell anónimo (`/offline`, `/offline/play`) vive
 * en otra caché y no se toca.
 */

const PAGE_CACHE_SUFFIX = "-pages";

export async function clearPwaPageCache(): Promise<void> {
  if (typeof caches === "undefined") {
    return;
  }
  try {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.endsWith(PAGE_CACHE_SUFFIX))
        .map((key) => caches.delete(key))
    );
  } catch {
    /* sin Cache Storage la app sigue funcionando */
  }
}

/**
 * Borra el hand-off de reproducción (fuente elegida en el diálogo) de
 * sessionStorage. Ese registro contiene la URL de la fuente, que puede ser una
 * capacidad debrid/CDN del perfil anterior, y no está ligado a la sesión.
 * Se limpia junto a la caché de páginas al cerrar sesión o cambiar de perfil.
 */
export function clearPlaybackHandoff(): void {
  if (typeof sessionStorage === "undefined") {
    return;
  }
  try {
    const keys: string[] = [];
    for (let index = 0; index < sessionStorage.length; index++) {
      const key = sessionStorage.key(index);
      if (
        key &&
        (key.startsWith("stream-source-") ||
          key.startsWith("stream-episode-title-"))
      ) {
        keys.push(key);
      }
    }
    for (const key of keys) {
      sessionStorage.removeItem(key);
    }
  } catch {
    /* almacenamiento no disponible */
  }
}
