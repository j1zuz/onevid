"use client";

import { Tooltip } from "@videojs/react";
import type { ReactElement, ReactNode } from "react";

/**
 * Tooltip de los controles del reproductor.
 *
 * Usa el tooltip del propio player (Video.js) en vez del de la UI compartida:
 * así los botones nuestros —volver, episodios, descargas, fuentes, audio…— se
 * ven EXACTAMENTE igual que los nativos (PiP, pantalla completa, ajustes) que
 * viven en la píldora de controles. El globo se pinta con las clases
 * `media-popup*` del skin, y el wrapper `media-skin` le da el tema (las reglas
 * del tooltip están ancladas a `.media-skin[data-theme="default"]`). El wrapper
 * es `display: contents`, así que no altera el layout de la fila de controles.
 */
export function PlayerTooltip({
  label,
  children,
  trigger,
}: {
  /** Texto (o nodo) del globo. */
  label: ReactNode;
  /** Contenido del botón cuando el gatillo se pasa como `trigger`. */
  children?: ReactNode;
  /** Botón ya montado (con sus props/estilos) que abre el tooltip. */
  trigger?: ReactElement;
}) {
  return (
    <span className="media-skin" data-theme="default" style={{ display: "contents" }}>
      <Tooltip.Root>
        <Tooltip.Trigger render={trigger}>{children}</Tooltip.Trigger>
        <Tooltip.Popup className="media-popup media-popup-safe-area media-popup-transition media-popup-surface media-tooltip">
          <Tooltip.Label>{label}</Tooltip.Label>
        </Tooltip.Popup>
      </Tooltip.Root>
    </span>
  );
}
