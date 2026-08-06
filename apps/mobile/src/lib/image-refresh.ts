import { useSyncExternalStore } from 'react';

// Contador global de "generación" de imágenes. En Android, la superficie nativa
// del reproductor (SurfaceView de LibVLC) descarta los bitmaps en GPU de las
// carátulas del Inicio, que siguen montadas debajo: al volver quedan en gris
// porque expo-image cree que la imagen ya está cargada y no la recarga. Subir la
// generación al salir del reproductor cambia el `recyclingKey` de las <Image>,
// forzando a expo-image a resetear y recargar desde su cache de disco (instante,
// sin red). Sólo se dispara al desmontar el player, así que cambiar de tab no
// recarga nada.

let generation = 0;
const listeners = new Set<() => void>();

export function bumpImageGeneration(): void {
  generation += 1;
  for (const l of listeners) l();
}

export function useImageGeneration(): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => generation,
    () => generation,
  );
}
