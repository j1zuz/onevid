import { MonitorPlayIcon } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { buttonVariants } from "@workspace/ui/components/button";
import { LoginDialog } from "@/components/login-dialog";
import { SiteFooter } from "@/components/site-footer";
import { LocalVideoPlayer } from "@/components/stream/local-video-player";
import { auth } from "@/lib/auth";

// Sin sesión, onevid arranca en MODO LOCAL (reproductor de video del
// dispositivo, sin configuración) — igual que la app móvil con useAppSurface.
// El header solo lleva un botón "Iniciar sesión" (abre un diálogo) para
// desbloquear el catálogo.
//
// Con sesión, esta ruta normalmente redirige a /home: eso lo decide el proxy
// (src/proxy.ts), ANTES de que este componente corra, así que si llegamos
// hasta acá con sesión es porque el proxy dejó pasar la navegación (el link
// "Modo local" del catálogo). Acá solo se usa la sesión para elegir qué
// mostrar en el header (login vs. volver al catálogo).
export default async function RootPage() {
  const session = await auth.api.getSession({ headers: await headers() });

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-1 flex-col border-border border-x border-dashed bg-background px-4 md:px-6">
      <header className="-mx-4 md:-mx-6 sticky top-0 z-20 flex items-center justify-between border-border border-b border-dashed bg-background/95 px-4 py-3 backdrop-blur supports-backdrop-filter:bg-background/80 md:px-6">
        <div className="flex items-center gap-2">
          {/* biome-ignore lint/performance/noImgElement: logo SVG estático local */}
          <img
            alt="onevid"
            className="size-8 rounded-md border border-border/70 bg-card p-1"
            height={32}
            src="/onevid.svg"
            width={32}
          />
          <span className="font-semibold text-sm">onevid</span>
        </div>
        {session ? (
          <Link
            className={buttonVariants({ variant: "outline" })}
            href="/home"
          >
            <MonitorPlayIcon data-icon="inline-start" />
            Volver al modo stream
          </Link>
        ) : (
          <LoginDialog />
        )}
      </header>

      <main className="flex flex-1 flex-col pt-6 pb-8">
        <LocalVideoPlayer />
      </main>

      <SiteFooter />
    </div>
  );
}
