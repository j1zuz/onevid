"use client";

import { Button } from "@workspace/ui/components/button";
import { Card, CardContent } from "@workspace/ui/components/card";
import { CookieIcon, X } from "lucide-react";
import Link from "next/link";
import posthog from "posthog-js";
import { useEffect, useState } from "react";
import { useTranslation } from "@/lib/onevid-i18n-context";

const CONSENT_COOKIE = "cookie_consent";
const CONSENT_ACCEPTED = "accepted";
const CONSENT_REJECTED = "rejected";

function getConsentCookie(): string | null {
  if (typeof document === "undefined") {
    return null;
  }
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${CONSENT_COOKIE}=([^;]*)`)
  );
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function setConsentCookie(value: string) {
  const maxAge = 60 * 60 * 24 * 365;
  // biome-ignore lint/suspicious/noDocumentCookie: setting consent cookie is intentional
  document.cookie = `${CONSENT_COOKIE}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; samesite=lax`;
}

export function CookieConsent() {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const consent = getConsentCookie();
    if (!consent) {
      setVisible(true);
      return;
    }
    if (consent === CONSENT_ACCEPTED) {
      try {
        posthog.opt_in_capturing();
      } catch {
        /* ignore */
      }
    }
  }, []);

  function reject() {
    setConsentCookie(CONSENT_REJECTED);
    setVisible(false);
    try {
      posthog.opt_out_capturing();
    } catch {
      /* ignore */
    }
  }

  function accept() {
    setConsentCookie(CONSENT_ACCEPTED);
    setVisible(false);
    try {
      posthog.opt_in_capturing();
    } catch {
      /* ignore */
    }
  }

  if (!visible) {
    return null;
  }

  return (
    <div
      aria-label={t("Consentimiento de cookies")}
      className="fixed bottom-4 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 shadow-lg"
      role="dialog"
    >
      <Card className="gap-3 py-4">
        <CardContent className="flex items-start gap-3 px-4">
          <CookieIcon
            aria-hidden
            className="mt-0.5 size-4 shrink-0 text-muted-foreground"
          />
          <div className="min-w-0 flex-1">
            <p className="mb-1 font-medium text-foreground text-xs">
              {t("Usamos cookies")}
            </p>
            <p className="text-muted-foreground text-xs">
              {t(
                "Utilizamos cookies esenciales para el funcionamiento de la plataforma y cookies de análisis para mejorar tu experiencia."
              )}{" "}
              <Link
                className="underline underline-offset-2 hover:text-foreground"
                href="/privacy"
              >
                {t("Política de privacidad")}
              </Link>
              .
            </p>
          </div>
          <button
            aria-label={t("Cerrar")}
            className="mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={reject}
            type="button"
          >
            <X className="size-3.5" />
          </button>
        </CardContent>
        <div className="flex items-center justify-end gap-2 px-4">
          <Button
            className="h-7 text-xs"
            onClick={reject}
            size="sm"
            variant="outline"
          >
            {t("Solo esenciales")}
          </Button>
          <Button
            className="btn-primary h-7 text-xs"
            onClick={accept}
            size="sm"
          >
            {t("Aceptar todo")}
          </Button>
        </div>
      </Card>
    </div>
  );
}
