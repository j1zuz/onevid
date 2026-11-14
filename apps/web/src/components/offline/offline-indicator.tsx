"use client";

import { WifiOffIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "@/lib/onevid-i18n-context";

/**
 * Aviso flotante cuando el dispositivo pierde internet. Enlaza a /offline, que
 * está precacheado por el service worker y lista las descargas de OPFS, así el
 * usuario no se queda mirando una pantalla de error del navegador.
 */
export function OfflineIndicator() {
  const { t: rawT } = useTranslation();
  const t = (key: string) => rawT(key as never) as unknown as string;
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (!offline) {
    return null;
  }

  return (
    <div
      className="fixed inset-x-3 bottom-3 z-50 mx-auto flex w-fit max-w-full items-center gap-2 rounded-full border border-border bg-background/95 py-1.5 pr-1.5 pl-3 text-xs shadow-lg backdrop-blur"
      role="status"
    >
      <WifiOffIcon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="whitespace-nowrap">{t("Sin conexión")}</span>
      <a
        className="rounded-full bg-primary px-2.5 py-1 font-medium text-primary-foreground"
        data-glimm-skip
        href="/offline"
      >
        {t("Ver descargas")}
      </a>
    </div>
  );
}
