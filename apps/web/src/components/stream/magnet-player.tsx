"use client";

import { useCallback, useState } from "react";
import {
  MagnetConsentGate,
  type MagnetGateError,
} from "@/components/stream/magnet-consent-gate";
import { StreamOnevid } from "@/components/stream/stream-onevid";

/**
 * Magnet pegado en el buscador: junta la puerta de consentimiento con el
 * reproductor. El cartel de consentimiento se mantiene encima con un spinner
 * hasta que el player tiene imagen (o falla), para no dejar la pantalla negra
 * mientras se resuelve el torrent en el debrid.
 */
export function MagnetPlayer({
  contentId,
  displayName,
  error,
  resolveUrl,
}: {
  contentId: string;
  displayName: string;
  error?: MagnetGateError | null;
  /** Endpoint de debrid que resuelve el magnet. */
  resolveUrl: string;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [ready, setReady] = useState(false);
  const handleReady = useCallback(() => setReady(true), []);
  const showGate = !confirmed || (!ready && !error);

  return (
    <>
      {confirmed && !error ? (
        <StreamOnevid
          contentId={contentId}
          contentTitle={displayName}
          contentType="movie"
          directSource={{
            addonId: "magnet",
            addonName: "Magnet link",
            sourceIndex: 0,
            title: displayName,
            url: resolveUrl,
          }}
          key={resolveUrl}
          onReady={handleReady}
          rawId={contentId}
        />
      ) : null}
      {showGate ? (
        <MagnetConsentGate
          error={error}
          loading={confirmed && !error}
          onConfirm={() => setConfirmed(true)}
          title={displayName}
        />
      ) : null}
    </>
  );
}
