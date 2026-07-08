"use client";

import { Button } from "@workspace/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import { Skeleton } from "@workspace/ui/components/skeleton";
import {
  CheckCircle2Icon,
  LoaderIcon,
  MonitorIcon,
  XCircleIcon,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { getDeviceErrorMessage } from "@/lib/device-errors";

type Outcome = "idle" | "approved" | "denied";

export default function DeviceApprovePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const userCode = searchParams.get("user_code") ?? "";

  const { data: session, isPending: sessionPending } = authClient.useSession();
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const [outcome, setOutcome] = useState<Outcome>("idle");
  const [error, setError] = useState<string | null>(null);

  if (sessionPending) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
        <Card className="w-full max-w-md">
          <CardHeader className="justify-items-center gap-2 text-center">
            <Skeleton className="size-10 rounded-full" />
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-64" />
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-2">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-8 w-56" />
          </CardContent>
          <CardFooter className="flex-col gap-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </CardFooter>
        </Card>
      </main>
    );
  }

  if (!session?.user) {
    const callback = encodeURIComponent(
      `/device/approve?user_code=${userCode}`
    );
    if (typeof window !== "undefined") {
      window.location.href = `/?callbackURL=${callback}`;
    }
    return null;
  }

  if (!userCode) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-4">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <CardTitle>Código no válido</CardTitle>
            <CardDescription>
              Falta el código del dispositivo. Vuelve a iniciar el proceso desde
              tu TV.
            </CardDescription>
          </CardHeader>
          <CardFooter className="justify-center">
            <Button
              className="btn-primary"
              onClick={() => router.push("/device")}
            >
              Ingresar código
            </Button>
          </CardFooter>
        </Card>
      </main>
    );
  }

  // Link the device code to this signed-in session. Required by better-auth
  // before approve/deny — without it the server returns "Device code has not
  // been claimed by a verifying session". Landing here directly (TV link/QR)
  // skips the /device step, so we claim on demand right before acting.
  async function claimCode(): Promise<boolean> {
    const { error: claimErr } = await authClient.device({
      query: { user_code: userCode },
    });
    if (claimErr) {
      setError(
        getDeviceErrorMessage(
          claimErr,
          "No pudimos validar el código. Vuelve a generarlo en tu TV."
        )
      );
      return false;
    }
    return true;
  }

  async function approve() {
    setError(null);
    setBusy("approve");
    if (!(await claimCode())) {
      setBusy(null);
      return;
    }
    const { error: err } = await authClient.device.approve({ userCode });
    setBusy(null);
    if (err) {
      setError(
        getDeviceErrorMessage(err, "No se pudo aprobar el dispositivo.")
      );
      return;
    }
    setOutcome("approved");
  }

  async function deny() {
    setError(null);
    setBusy("deny");
    if (!(await claimCode())) {
      setBusy(null);
      return;
    }
    const { error: err } = await authClient.device.deny({ userCode });
    setBusy(null);
    if (err) {
      setError(
        getDeviceErrorMessage(err, "No se pudo rechazar el dispositivo.")
      );
      return;
    }
    setOutcome("denied");
  }

  if (outcome === "approved") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-4">
        <Card className="w-full max-w-md text-center">
          <CardHeader className="justify-items-center gap-2">
            <CheckCircle2Icon className="size-12 text-green-600 dark:text-green-500" />
            <CardTitle>¡Listo!</CardTitle>
            <CardDescription>
              Tu TV ya está autorizada. Vuelve a ella para continuar.
            </CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }

  if (outcome === "denied") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-4">
        <Card className="w-full max-w-md text-center">
          <CardHeader className="justify-items-center gap-2">
            <XCircleIcon className="size-12 text-destructive" />
            <CardTitle>Acceso rechazado</CardTitle>
            <CardDescription>
              No autorizaste a este dispositivo. Puedes cerrar esta ventana.
            </CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader className="justify-items-center gap-2 text-center">
          <MonitorIcon className="size-10 text-muted-foreground" />
          <CardTitle>Autorizar dispositivo</CardTitle>
          <CardDescription>
            ¿Eres tú quien intenta iniciar sesión en una TV con este código?
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-2">
          <span className="text-muted-foreground text-sm">Código</span>
          <span className="font-mono text-2xl tracking-[0.4em]">
            {userCode.slice(0, 4)}-{userCode.slice(4)}
          </span>
          {error ? (
            <p className="mt-2 text-center text-destructive text-sm">{error}</p>
          ) : null}
        </CardContent>
        <CardFooter className="flex-col gap-2">
          <Button
            className="btn-primary w-full"
            disabled={busy !== null}
            onClick={approve}
            type="button"
          >
            {busy === "approve" ? (
              <LoaderIcon
                className="size-4 animate-spin"
                data-icon="inline-start"
              />
            ) : null}
            Aprobar
          </Button>
          <Button
            className="w-full"
            disabled={busy !== null}
            onClick={deny}
            type="button"
            variant="outline"
          >
            {busy === "deny" ? (
              <LoaderIcon
                className="size-4 animate-spin"
                data-icon="inline-start"
              />
            ) : null}
            Rechazar
          </Button>
        </CardFooter>
      </Card>
    </main>
  );
}
