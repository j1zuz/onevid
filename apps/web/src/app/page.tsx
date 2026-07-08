import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { LoginDialog } from "@/components/login-dialog";
import { LocalVideoPlayer } from "@/components/stream/local-video-player";
import { auth } from "@/lib/auth";

// Sin sesión, onevid arranca en MODO LOCAL (reproductor de video del
// dispositivo, sin configuración) — igual que la app móvil con useAppSurface.
// El header solo lleva un botón "Iniciar sesión" (abre un diálogo) para
// desbloquear el catálogo. Con sesión, se entra directo a la experiencia onevid.
export default async function RootPage() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (session) {
    redirect("/home/projects/onevid");
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-7xl flex-1 flex-col border-border border-x border-dashed bg-background px-4 md:px-6">
      <header className="-mx-4 md:-mx-6 sticky top-0 z-20 flex items-center justify-between border-border/50 border-b bg-background/95 px-4 py-3 backdrop-blur supports-backdrop-filter:bg-background/80 md:px-6">
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
        <LoginDialog />
      </header>

      <main className="flex flex-1 flex-col pt-6 pb-8">
        <LocalVideoPlayer />
      </main>
    </div>
  );
}
