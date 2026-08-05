"use client";

import { Button } from "@workspace/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "@workspace/ui/components/input-otp";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { REGEXP_ONLY_DIGITS_AND_CHARS } from "input-otp";
import { LoaderIcon } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { getDeviceErrorMessage } from "@/lib/device-errors";

const USER_CODE_LENGTH = 8;

function normalizeCode(raw: string): string {
  return raw
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase()
    .slice(0, USER_CODE_LENGTH);
}

export default function DeviceVerifyPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialCode = useMemo(
    () => normalizeCode(searchParams.get("user_code") ?? ""),
    [searchParams]
  );

  const { data: session, isPending: sessionPending } = authClient.useSession();
  const [code, setCode] = useState(initialCode);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialCode) {
      setCode(initialCode);
    }
  }, [initialCode]);

  if (sessionPending) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
        <Card className="w-full max-w-md">
          <CardHeader className="items-center gap-2 text-center">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-64" />
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-6">
            <div className="flex items-center gap-2">
              {Array.from({ length: USER_CODE_LENGTH / 2 }).map((_, i) => (
                <Skeleton className="size-10" key={`s-a-${i.toString()}`} />
              ))}
              <Skeleton className="h-1 w-4" />
              {Array.from({ length: USER_CODE_LENGTH / 2 }).map((_, i) => (
                <Skeleton className="size-10" key={`s-b-${i.toString()}`} />
              ))}
            </div>
            <Skeleton className="h-9 w-full" />
          </CardContent>
        </Card>
      </main>
    );
  }

  if (!session?.user) {
    const target = `/device${initialCode ? `?user_code=${initialCode}` : ""}`;
    const callback = encodeURIComponent(target);
    if (typeof window !== "undefined") {
      window.location.href = `/?callbackURL=${callback}`;
    }
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (code.length !== USER_CODE_LENGTH) {
      setError("Ingresa el código completo.");
      return;
    }
    setSubmitting(true);
    const { error: claimError } = await authClient.device({
      query: { user_code: code },
    });
    setSubmitting(false);
    if (claimError) {
      setError(
        getDeviceErrorMessage(
          claimError,
          "No pudimos validar el código. Verifica e intenta de nuevo."
        )
      );
      return;
    }
    router.push(`/device/approve?user_code=${code}`);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle>Activar dispositivo</CardTitle>
          <CardDescription>
            Ingresa el código que aparece en tu TV para autorizarla.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col items-center gap-6"
            onSubmit={handleSubmit}
          >
            <InputOTP
              autoFocus
              // El código es alfanumérico (p. ej. "N72D-AH3S"). input-otp usa
              // inputMode="numeric" por defecto y en el móvil saca el teclado
              // numérico, que no deja escribir letras: forzamos "text" para el
              // teclado y el patrón alfanumérico estándar para los caracteres.
              inputMode="text"
              maxLength={USER_CODE_LENGTH}
              onChange={(value) => setCode(normalizeCode(value))}
              pattern={REGEXP_ONLY_DIGITS_AND_CHARS}
              value={code}
            >
              <InputOTPGroup>
                {Array.from({ length: USER_CODE_LENGTH / 2 }).map((_, i) => (
                  <InputOTPSlot
                    className="size-10 text-base"
                    index={i}
                    key={`a-${i.toString()}`}
                  />
                ))}
              </InputOTPGroup>
              <InputOTPSeparator />
              <InputOTPGroup>
                {Array.from({ length: USER_CODE_LENGTH / 2 }).map((_, i) => (
                  <InputOTPSlot
                    className="size-10 text-base"
                    index={i + USER_CODE_LENGTH / 2}
                    key={`b-${i.toString()}`}
                  />
                ))}
              </InputOTPGroup>
            </InputOTP>

            {error ? (
              <p className="text-center text-destructive text-sm">{error}</p>
            ) : null}

            <Button
              className="btn-primary w-full"
              disabled={submitting || code.length !== USER_CODE_LENGTH}
              type="submit"
            >
              {submitting ? (
                <LoaderIcon
                  className="size-4 animate-spin"
                  data-icon="inline-start"
                />
              ) : null}
              Continuar
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
