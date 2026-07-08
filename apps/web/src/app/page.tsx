import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { auth } from "@/lib/auth";

// onevid tiene login propio (magic link + Google) contra la MISMA base de datos
// que hackw. La sesión resultante también es válida en hackw.tech (cookie
// compartida en producción vía COOKIE_DOMAIN). Con sesión, entra al catálogo.
export default async function RootPage() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (session) {
    redirect("/home/projects/onevid");
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <LoginForm />
    </main>
  );
}
