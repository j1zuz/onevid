import type { QueryClient } from '@tanstack/react-query';
import * as FileSystem from 'expo-file-system/legacy';

/** Video propio del dispositivo guardado en la biblioteca local. */
export interface LocalVideo {
  id: string;
  /** URI local del archivo (o URL remota si se agregó por enlace). */
  uri: string;
  title: string;
  addedAt: number;
}

const FILE = `${FileSystem.documentDirectory ?? ''}onevid-local-videos.json`;

export const LOCAL_VIDEOS_KEY = ['local-videos'] as const;

/**
 * Biblioteca local (modo "Continuar sin cuenta"): los videos que el usuario
 * agregó desde su dispositivo o por URL, persistidos en un JSON dentro del
 * directorio de documentos de la app.
 */
export const localVideosQuery = () => ({
  queryKey: LOCAL_VIDEOS_KEY,
  // Es data local: no hay nada que revalidar; se invalida al agregar/quitar.
  staleTime: Infinity,
  gcTime: Infinity,
  queryFn: async (): Promise<LocalVideo[]> => {
    try {
      const info = await FileSystem.getInfoAsync(FILE);
      if (!info.exists) return [];
      const raw = await FileSystem.readAsStringAsync(FILE);
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as LocalVideo[]) : [];
    } catch {
      return [];
    }
  },
});

async function persist(list: LocalVideo[]): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(FILE, JSON.stringify(list));
  } catch {
    /* best-effort: si falla el guardado seguimos con la lista en memoria */
  }
}

/** Agrega (o mueve al principio si ya existía) un video a la biblioteca local. */
export async function addLocalVideo(
  qc: QueryClient,
  input: { uri: string; title: string },
): Promise<void> {
  const current =
    qc.getQueryData<LocalVideo[]>(LOCAL_VIDEOS_KEY) ??
    (await qc.fetchQuery(localVideosQuery()).catch(() => []));
  const entry: LocalVideo = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    uri: input.uri,
    title: input.title,
    addedAt: Date.now(),
  };
  const next = [entry, ...current.filter((v) => v.uri !== input.uri)];
  qc.setQueryData(LOCAL_VIDEOS_KEY, next);
  await persist(next);
}

export async function removeLocalVideo(
  qc: QueryClient,
  id: string,
): Promise<void> {
  const current = qc.getQueryData<LocalVideo[]>(LOCAL_VIDEOS_KEY) ?? [];
  const next = current.filter((v) => v.id !== id);
  qc.setQueryData(LOCAL_VIDEOS_KEY, next);
  await persist(next);
}

/** Título legible a partir del nombre de archivo (sin extensión). */
export function titleFromFileName(name: string | null | undefined): string {
  const base = name ?? 'Video';
  const i = base.lastIndexOf('.');
  return i > 0 ? base.slice(0, i) : base;
}
