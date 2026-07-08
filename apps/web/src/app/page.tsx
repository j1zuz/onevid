import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

// onevid no tiene su propia UI de login: la sesión se comparte con hackw.tech
// vía cookie cross-subdominio. Si no hay sesión, se manda al usuario a
// iniciar sesión en hackw; al volver, la cookie compartida ya lo autentica aquí.
const HACKW_APP_URL = process.env.HACKW_APP_URL ?? "https://hackw.tech";

export default async function RootPage() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (session) {
    redirect("/home/projects/onevid");
  }

  redirect(HACKW_APP_URL);
}
