import type { CSSProperties } from "react";

/**
 * Tamaño de los botones propios del reproductor (audio/subtítulos, episodios,
 * descarga, fuentes, ver juntos, chat, volver).
 *
 * Antes iban con utilidades fijas de Tailwind (`size-9` / `size-5`), así que en
 * pantalla completa se quedaban en 36/20 px mientras los botones nativos del
 * skin crecen con `--media-scale` (hasta 1.75 según el ancho) y se veían más
 * pequeños que los de al lado. Las variables las define la skin y son las
 * mismas que usan sus botones, así que ahora escalan igual.
 *
 * Van en línea y no en clases a propósito: `style` gana a cualquier utilidad o
 * regla de la hoja de estilos, así que no dependen de en qué contenedor caiga
 * el botón (píldora de controles, portal o barra superior).
 */
export const playerControlStyle: CSSProperties = {
  width: "var(--media-control-size, 2.25rem)",
  height: "var(--media-control-size, 2.25rem)",
};

export const playerControlIconStyle: CSSProperties = {
  // ×1.25: los iconos de Lucide dejan ~2 px de aire dentro de su viewBox de 24
  // (el glifo ocupa ~0.75 del cajón) mientras los del skin lo llenan casi
  // entero (~0.95). Medido sobre una captura en pantalla completa: gear nativo
  // 26 px de tinta con cajón 27; los nuestros 15 px con cajón 20. Con el mismo
  // cajón que el skin y este factor, la tinta coincide (~17 px a escala 1).
  width: "calc(var(--media-icon-size, calc(var(--media-spacing, 4px) * 4.5)) * 1.25)",
  height: "calc(var(--media-icon-size, calc(var(--media-spacing, 4px) * 4.5)) * 1.25)",
};
