import { getSessionCookie } from "better-auth/cookies";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

// / es la pantalla de "modo local" (reproductor sin cuenta). Con sesión, un
// usuario que navega ahí directo (URL, bookmark, refresh) debe caer en /home;
// pero el link "Modo local" del catálogo también apunta a / y ese caso sí debe
// quedarse ahí. La única señal que los distingue sin ensuciar la URL con un
// query param es el Referer: si viene de /home, se deja pasar.
export function proxy(request: NextRequest) {
  const hasSession = Boolean(getSessionCookie(request));
  if (!hasSession) {
    return;
  }

  const referer = request.headers.get("referer");
  let cameFromCatalog = false;
  if (referer) {
    try {
      const refererUrl = new URL(referer);
      cameFromCatalog =
        refererUrl.origin === request.nextUrl.origin &&
        refererUrl.pathname.startsWith("/home");
    } catch {
      cameFromCatalog = false;
    }
  }

  if (!cameFromCatalog) {
    return NextResponse.redirect(new URL("/home", request.url));
  }
}

export const config = {
  matcher: "/",
};
