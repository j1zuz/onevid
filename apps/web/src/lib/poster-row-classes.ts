/**
 * Clases compartidas por las filas horizontales del feed.
 *
 * Viven en un módulo sin `"use client"` para que también las puedan importar
 * los skeletons de servidor (`app/home/loading.tsx`) sin cruzar el límite de
 * cliente de `poster-card.tsx`.
 */

/**
 * Fila horizontal del inicio (estilo carrusel): las tarjetas van una al lado de
 * otra y se deslizan hacia los lados, en vez de apilarse hacia abajo.
 */
export const POSTER_ROW_CLASS =
  "no-scrollbar -mx-2 flex snap-x snap-mandatory gap-4 overflow-x-auto px-2 pb-1";

/** Ancho fijo de cada tarjeta dentro de la fila horizontal. */
export const POSTER_ROW_ITEM_CLASS =
  "w-64 shrink-0 snap-start sm:w-72";
