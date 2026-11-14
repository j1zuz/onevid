"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useTranslation } from "@/lib/onevid-i18n-context";

const UPDATE_TOAST_ID = "onevid-service-worker-update";
// Cada cuánto se le pregunta al navegador si hay un sw.js nuevo (además de al
// volver a la pestaña y al recuperar conexión).
const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;
// Si el service worker no dispara `controllerchange` (navegadores viejos), no
// dejamos al usuario esperando: recargamos igual.
const RELOAD_FALLBACK_MS = 2500;

/**
 * Registra el service worker que da soporte sin conexión a la PWA y avisa
 * cuando hay una versión nueva.
 *
 * El SW nuevo queda en `waiting` a propósito (no hace `skipWaiting()` solo):
 * así no le cambiamos el bundle por debajo a una app abierta. Cuando el usuario
 * toca "Actualizar" le mandamos `SKIP_WAITING` y recargamos con el HTML/JS
 * nuevos, así nadie queda pegado a una versión cacheada vieja.
 *
 * Solo en producción: en `next dev` un SW con caché stale hace más daño que
 * bien (assets con hash que cambian en cada compilación).
 */
export function ServiceWorkerRegistrar() {
  const { t } = useTranslation();
  const waitingWorker = useRef<ServiceWorker | null>(null);
  // `t` cambia de identidad cuando cambia el idioma; guardarlo en un ref evita
  // re-registrar el SW por eso.
  const translate = useRef(t);
  useEffect(() => {
    translate.current = t;
  }, [t]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      return;
    }
    if (!("serviceWorker" in navigator)) {
      return;
    }

    let cancelled = false;
    let registration: ServiceWorkerRegistration | null = null;
    let checkInterval: number | undefined;
    let applyingUpdate = false;

    const tr = (key: string) => translate.current(key as never) as string;

    const reload = () => {
      window.location.reload();
    };

    const applyUpdate = () => {
      toast.dismiss(UPDATE_TOAST_ID);
      const worker = waitingWorker.current;
      applyingUpdate = true;
      // El worker ya se activó (por ejemplo, otra pestaña aplicó la
      // actualización): solo falta recargar.
      if (!worker || worker.state !== "installed") {
        reload();
        return;
      }
      worker.postMessage("SKIP_WAITING");
      window.setTimeout(reload, RELOAD_FALLBACK_MS);
    };

    const showUpdateToast = () => {
      toast(tr("Nueva actualización disponible"), {
        action: { label: tr("Actualizar"), onClick: applyUpdate },
        duration: Number.POSITIVE_INFINITY,
        id: UPDATE_TOAST_ID,
      });
    };

    const markWaiting = (worker: ServiceWorker | null) => {
      // Sin controller no hay versión anterior que reemplazar (instalación
      // inicial): no corresponde avisar ni recargar. Se consulta en el momento
      // porque en la primera visita el SW puede tomar el control después de
      // montar el componente.
      if (!worker || !navigator.serviceWorker.controller) {
        return;
      }
      waitingWorker.current = worker;
      showUpdateToast();
    };

    const onControllerChange = () => {
      // Solo recargamos cuando la actualización la pidió este usuario; si no,
      // una pestaña de fondo perdería el estado sin motivo.
      if (applyingUpdate) {
        reload();
      }
    };
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      onControllerChange
    );

    const watchInstalling = (reg: ServiceWorkerRegistration) => {
      const worker = reg.installing;
      if (!worker) {
        return;
      }
      worker.addEventListener("statechange", () => {
        // `installed` + controller existente = hay versión nueva esperando.
        if (worker.state === "installed") {
          markWaiting(worker);
        }
      });
    };

    const register = async () => {
      try {
        // `updateViaCache: "none"` evita que el navegador sirva el sw.js desde
        // su caché HTTP: sin esto un deploy puede tardar hasta 24 h en verse.
        const reg = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          updateViaCache: "none",
        });
        if (cancelled) {
          return;
        }
        registration = reg;
        // Actualización detectada en una visita anterior y todavía esperando.
        if (reg.waiting) {
          markWaiting(reg.waiting);
        }
        reg.addEventListener("updatefound", () => watchInstalling(reg));
      } catch {
        /* sin SW la app sigue funcionando, solo pierde el modo offline */
      }
    };

    const checkForUpdate = () => {
      if (document.visibilityState === "hidden") {
        return;
      }
      registration?.update().catch(() => {
        /* offline: se reintenta en el próximo chequeo */
      });
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        checkForUpdate();
      }
    };

    const onLoad = () => {
      void register();
    };

    if (document.readyState === "complete") {
      void register();
    } else {
      window.addEventListener("load", onLoad, { once: true });
    }

    checkInterval = window.setInterval(
      checkForUpdate,
      UPDATE_CHECK_INTERVAL_MS
    );
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("online", checkForUpdate);

    return () => {
      cancelled = true;
      if (checkInterval !== undefined) {
        window.clearInterval(checkInterval);
      }
      window.removeEventListener("load", onLoad);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("online", checkForUpdate);
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        onControllerChange
      );
    };
  }, []);

  return null;
}
