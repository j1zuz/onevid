import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { OneVidModeShell } from "@/components/stream/onevid-mode-shell";
import { auth } from "@/lib/auth";

// Sin sesión, onevid arranca en MODO LOCAL (reproductor de video del
// dispositivo, sin configuración) — igual que la app móvil con useAppSurface.
// El tab "Stream" pide iniciar sesión (magic link + Google) para desbloquear el
// catálogo. Con sesión, se entra directo a la experiencia onevid completa.
export default async function RootPage() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (session) {
    redirect("/home/projects/onevid");
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-7xl flex-1 flex-col bg-background px-4 pt-6 pb-8 md:px-6">
      <OneVidModeShell defaultMode="local">
        <div className="flex justify-center py-6">
          <LoginForm />
        </div>
      </OneVidModeShell>
    </main>
  );
}
