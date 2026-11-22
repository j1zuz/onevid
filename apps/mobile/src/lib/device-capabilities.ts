import * as Device from 'expo-device';
import { useEffect, useState } from 'react';

/**
 * Clase de memoria del dispositivo para adaptar la app a gama baja.
 *
 * `Device.getMaxMemoryAsync()` devuelve el heap máximo de la Java VM (bytes), no
 * la RAM total. En un móvil de 2 GB suele quedar entre ~192 y ~256 MB, mientras
 * que un gama alta pasa de 384 MB. Es la señal más fiable que expone Expo sin
 * un módulo nativo propio; `ActivityManager.isLowRamDevice()` solo marca ~1 GB
 * o menos y por eso no sirve para detectar un 2 GB.
 */
const LOW_MEMORY_MAX_HEAP_MB = 256;

export type DeviceMemoryClass = 'low' | 'medium' | 'high' | 'unknown';

let cachedMaxHeapMb: number | null = null;
let pendingMaxHeapMb: Promise<number | null> | null = null;

/** Heap máximo de la app en MB, o `null` si la plataforma no lo expone. */
export function getMaxHeapMb(): Promise<number | null> {
  if (cachedMaxHeapMb != null) {
    return Promise.resolve(cachedMaxHeapMb);
  }
  if (pendingMaxHeapMb) {
    return pendingMaxHeapMb;
  }
  if (typeof Device.getMaxMemoryAsync !== 'function') {
    return Promise.resolve(null);
  }
  pendingMaxHeapMb = Device.getMaxMemoryAsync()
    .then((bytes) => {
      const mb = Math.round(bytes / (1024 * 1024));
      cachedMaxHeapMb = mb;
      return mb;
    })
    .catch(() => null);
  return pendingMaxHeapMb;
}

export function memoryClassFor(maxHeapMb: number | null): DeviceMemoryClass {
  if (maxHeapMb == null) return 'unknown';
  if (maxHeapMb <= LOW_MEMORY_MAX_HEAP_MB) return 'low';
  if (maxHeapMb <= 384) return 'medium';
  return 'high';
}

/** `true` cuando el heap de la app es de gama baja (típico de 2 GB de RAM). */
export function useLowMemory(): boolean {
  const [low, setLow] = useState<boolean>(
    cachedMaxHeapMb != null && cachedMaxHeapMb <= LOW_MEMORY_MAX_HEAP_MB,
  );

  useEffect(() => {
    if (cachedMaxHeapMb != null) return;
    let cancelled = false;
    getMaxHeapMb().then((mb) => {
      if (!cancelled) {
        setLow(mb != null && mb <= LOW_MEMORY_MAX_HEAP_MB);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return low;
}

export function useDeviceMemoryClass(): DeviceMemoryClass {
  const [memoryClass, setMemoryClass] = useState<DeviceMemoryClass>(() =>
    memoryClassFor(cachedMaxHeapMb),
  );

  useEffect(() => {
    let cancelled = false;
    getMaxHeapMb().then((mb) => {
      if (!cancelled) setMemoryClass(memoryClassFor(mb));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return memoryClass;
}
