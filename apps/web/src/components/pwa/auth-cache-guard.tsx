"use client";

import { useEffect, useRef } from "react";
import { authClient } from "@/lib/auth-client";
import { clearPwaPageCache, clearPlaybackHandoff } from "@/lib/pwa-cache";

/**
 * Limpia la caché de navegación del service worker cuando aparece una sesión
 * o cambia de usuario. El logout y el cambio de perfil ya la limpian; esto
 * cubre el caso "entré con otra cuenta / la sesión anterior expiró" en el que
 * no hubo un signOut explícito y una navegación offline podía servir el HTML
 * del usuario anterior.
 *
 * Se limpia una vez por carga autenticada. La caché se vuelve a llenar con las
 * páginas que el usuario visite en esta sesión, así que el modo offline de
 * /offline y del shell sigue funcionando.
 */
export function AuthCacheGuard() {
  const { data } = authClient.useSession();
  const userId = data?.user?.id ?? null;
  const previousUserId = useRef<string | null | undefined>(undefined);
  const clearedForMount = useRef(false);

  useEffect(() => {
    if (!userId) {
      previousUserId.current = userId;
      return;
    }
    const changed =
      previousUserId.current !== undefined && previousUserId.current !== userId;
    if (!clearedForMount.current || changed) {
      clearedForMount.current = true;
      void clearPwaPageCache();
      clearPlaybackHandoff();
    }
    previousUserId.current = userId;
  }, [userId]);

  return null;
}
