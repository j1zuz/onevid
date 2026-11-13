import * as FileSystem from 'expo-file-system/legacy';
import { AppState } from 'react-native';

const EXPIRATION_MS = 24 * 60 * 60 * 1000;
const METADATA_FILE = `${FileSystem.documentDirectory ?? ''}onevid-offline-videos.json`;
const DOWNLOAD_DIRECTORY = `${FileSystem.documentDirectory ?? ''}offline/`;
// Estado de una descarga pausada (o interrumpida) para poder reanudarla. Vive
// aparte del metadata de descargas completas porque no es una entrada válida.
const PARTIALS_FILE = `${FileSystem.documentDirectory ?? ''}onevid-offline-partials.json`;
// Un parcial que nadie tocó en este tiempo ya no se va a reanudar: ocupa GB y
// solo sirve para llenar el disco.
const PARTIAL_TTL_MS = 72 * 60 * 60 * 1000;

export interface OfflineVideo {
  key: string;
  uri: string;
  title: string;
  downloadedAt: number;
  expiresAt: number;
  /**
   * Pista de audio que el usuario tenía elegida al descargar. El archivo se
   * copia tal cual (todas las pistas siguen dentro), así que al reproducirlo
   * offline se preselecciona esta en vez de caer al default de libVLC. `name`
   * y `index` se guardan juntos: el nombre es lo que expone VLC y el índice
   * sirve de respaldo cuando varias pistas se llaman igual o no tienen nombre.
   */
  audioTrackName?: string;
  audioTrackIndex?: number;
}

export interface OfflineDownloadControl {
  cancelled: boolean;
  cancel: () => Promise<void>;
}

/**
 * Pista de audio que el usuario tenía elegida. El archivo descargado es una
 * copia literal del origen (todas las pistas siguen dentro), así que esto solo
 * sirve para preseleccionar ese idioma al reproducirlo sin conexión.
 */
export interface OfflineAudioSelection {
  /** Nombre tal cual lo expone libVLC (suele llevar idioma/códec). */
  name?: string;
  /** Índice 0-based dentro de la lista de pistas de audio del player. */
  index?: number;
}

function fileNameForKey(key: string): string {
  const safeKey = encodeURIComponent(key).replace(/%/g, '_').slice(0, 180);
  return `onevid-${safeKey}.mp4`;
}

interface PartialDownload {
  key: string;
  /** Estado que devuelve `pauseAsync()`/`savable()` de expo-file-system. */
  state: FileSystem.DownloadPauseState;
  updatedAt: number;
}

async function readPartials(): Promise<Record<string, PartialDownload>> {
  try {
    const info = await FileSystem.getInfoAsync(PARTIALS_FILE);
    if (!info.exists) return {};
    const parsed: unknown = JSON.parse(
      await FileSystem.readAsStringAsync(PARTIALS_FILE),
    );
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const now = Date.now();
    const result: Record<string, PartialDownload> = {};
    for (const [key, value] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      if (!value || typeof value !== 'object') continue;
      const item = value as Partial<PartialDownload>;
      if (!item.state || typeof item.state.fileUri !== 'string') continue;
      const updatedAt = Number(item.updatedAt);
      if (!Number.isFinite(updatedAt) || now - updatedAt > PARTIAL_TTL_MS) {
        continue;
      }
      result[key] = { key, state: item.state, updatedAt };
    }
    return result;
  } catch {
    return {};
  }
}

async function writePartials(
  map: Record<string, PartialDownload>,
): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(PARTIALS_FILE, JSON.stringify(map));
  } catch {
    // Best-effort: perder el estado solo cuesta reiniciar la descarga.
  }
}

async function savePartial(
  key: string,
  state: FileSystem.DownloadPauseState,
): Promise<void> {
  if (!state.resumeData) return;
  const map = await readPartials();
  map[key] = { key, state, updatedAt: Date.now() };
  await writePartials(map);
}

async function clearPartial(key: string): Promise<void> {
  const map = await readPartials();
  if (!(key in map)) return;
  delete map[key];
  await writePartials(map);
}

/**
 * Pausa la descarga para quedarse con el `resumeData` (es la única forma que da
 * expo-file-system de continuar donde quedó). Sin esto, un corte obliga a bajar
 * los GB otra vez desde cero.
 */
async function persistPartial(
  key: string,
  download: FileSystem.DownloadResumable,
): Promise<void> {
  try {
    const state = await download.pauseAsync();
    await savePartial(key, state);
  } catch {
    // Si ya había fallado, `pauseAsync` no puede darnos un estado utilizable.
  }
}

/**
 * Borra restos que no pertenecen a ninguna descarga: archivos huérfanos de un
 * `moveAsync` interrumpido y `.part` que nunca se van a reanudar. Solo toca lo
 * viejo, para no pisar una descarga en curso.
 */
async function pruneDownloadDirectory(valid: OfflineVideo[]): Promise<void> {
  try {
    const info = await FileSystem.getInfoAsync(DOWNLOAD_DIRECTORY);
    if (!info.exists || !info.isDirectory) return;
    const known = new Set(valid.map((item) => item.uri));
    const partials = await readPartials();
    const removablePartials = new Set(
      Object.values(partials).map((item) => item.state.fileUri),
    );
    const now = Date.now();
    const names = await FileSystem.readDirectoryAsync(DOWNLOAD_DIRECTORY);
    for (const name of names) {
      const uri = `${DOWNLOAD_DIRECTORY}${name}`;
      if (known.has(uri) || removablePartials.has(uri)) continue;
      const entry = await FileSystem.getInfoAsync(uri);
      if (!entry.exists) continue;
      const age = now - (entry.modificationTime ?? 0) * 1000;
      if (age < PARTIAL_TTL_MS) continue;
      await removeFile(uri);
    }
  } catch {
    // La limpieza nunca debe romper la lectura de descargas.
  }
}

async function readMetadata(): Promise<OfflineVideo[]> {
  try {
    const info = await FileSystem.getInfoAsync(METADATA_FILE);
    if (!info.exists) return [];
    const parsed: unknown = JSON.parse(
      await FileSystem.readAsStringAsync(METADATA_FILE),
    );
    return Array.isArray(parsed) ? (parsed as OfflineVideo[]) : [];
  } catch {
    return [];
  }
}

async function writeMetadata(list: OfflineVideo[]): Promise<void> {
  await FileSystem.writeAsStringAsync(METADATA_FILE, JSON.stringify(list));
}

async function removeFile(uri: string): Promise<void> {
  const info = await FileSystem.getInfoAsync(uri);
  if (info.exists) await FileSystem.deleteAsync(uri, { idempotent: true });
}

export async function getOfflineVideo(key: string): Promise<OfflineVideo | null> {
  const now = Date.now();
  const list = await readMetadata();
  const valid: OfflineVideo[] = [];
  let match: OfflineVideo | null = null;

  for (const item of list) {
    const expired = item.expiresAt <= now;
    let file: FileSystem.FileInfo;
    try {
      file = await FileSystem.getInfoAsync(item.uri);
    } catch {
      file = { exists: false, isDirectory: false, uri: item.uri };
    }
    if (expired || !file.exists) {
      await removeFile(item.uri).catch(() => undefined);
      continue;
    }
    valid.push(item);
    if (item.key === key) match = item;
  }

  if (valid.length !== list.length) {
    await writeMetadata(valid);
  }
  await pruneDownloadDirectory(valid);
  return match;
}

export async function downloadOfflineVideo(input: {
  key: string;
  url: string;
  title: string;
  /** Pista de audio activa en el player al iniciar la descarga. */
  audioTrackName?: string;
  audioTrackIndex?: number;
  control?: OfflineDownloadControl;
  onProgress?: (progress: number) => void;
}): Promise<OfflineVideo> {
  if (!input.url.trim()) {
    throw new Error('No hay una URL válida para descargar.');
  }

  await FileSystem.makeDirectoryAsync(DOWNLOAD_DIRECTORY, {
    intermediates: true,
  });

  const destination = `${DOWNLOAD_DIRECTORY}${fileNameForKey(input.key)}`;
  const temporary = `${destination}.part`;

  // Solo se reanuda si el parcial guardado corresponde a ESTE archivo. El
  // `resumeData` de expo lleva la URL y el estado de la transferencia, así que
  // sirve para continuar donde quedó (incluso tras cerrar la app).
  const partials = await readPartials();
  const saved = partials[input.key];
  const resumeData =
    saved && saved.state.fileUri === temporary
      ? saved.state.resumeData
      : undefined;

  const reportProgress = (progress: FileSystem.DownloadProgressData) => {
    const expected = progress.totalBytesExpectedToWrite;
    const value = expected > 0 ? progress.totalBytesWritten / expected : 0;
    input.onProgress?.(Math.min(1, Math.max(0, value)));
  };

  let activeDownload: FileSystem.DownloadResumable | null = null;
  let pausedForBackground = false;
  // Pausar al salir de la app es la interrupción más común (pantalla apagada,
  // cambio de app) y es el único momento en el que expo nos entrega el
  // `resumeData` necesario para continuar después.
  const backgroundSubscription = AppState.addEventListener(
    'change',
    (status) => {
      if (status === 'active' || pausedForBackground || !activeDownload) {
        return;
      }
      pausedForBackground = true;
      void persistPartial(input.key, activeDownload).catch(() => undefined);
    },
  );

  const attempt = async (resume?: string) => {
    const download = FileSystem.createDownloadResumable(
      input.url,
      temporary,
      {},
      reportProgress,
      resume,
    );
    activeDownload = download;
    if (input.control) {
      input.control.cancelled = false;
      input.control.cancel = async () => {
        input.control!.cancelled = true;
        await download.cancelAsync();
      };
    }
    try {
      const result = await download.downloadAsync();
      if (!result?.uri) {
        if (input.control?.cancelled) {
          throw new Error('Descarga cancelada.');
        }
        if (pausedForBackground) {
          throw new Error(
            'Descarga pausada. Se reanudará cuando vuelvas a descargar.',
          );
        }
        throw new Error('La descarga no devolvió un archivo.');
      }
      return result;
    } catch (error) {
      if (!input.control?.cancelled && !pausedForBackground) {
        // Guardar lo avanzado: el próximo intento continúa desde acá en vez de
        // volver a bajar los GB enteros.
        await persistPartial(input.key, download);
      }
      throw error;
    }
  };

  try {
    let result: FileSystem.FileSystemDownloadResult | undefined;
    try {
      result = await attempt(resumeData);
    } catch (error) {
      if (input.control?.cancelled) {
        // Cancelar es una decisión del usuario: se descarta el parcial para no
        // dejarle GB ocupando espacio que no pidió conservar.
        await clearPartial(input.key);
        await removeFile(temporary);
        throw new Error('Descarga cancelada.');
      }
      // Pausada por pasar a segundo plano: el estado ya quedó guardado y el
      // usuario la retoma al volver a descargar. No se reintenta ni se borra.
      if (pausedForBackground) {
        throw error instanceof Error
          ? error
          : new Error('Descarga pausada.');
      }
      if (!resumeData) {
        throw error instanceof Error
          ? error
          : new Error('No se pudo completar la descarga.');
      }
      // Reanudar falló (link firmado caducado, parcial corrupto…): un intento
      // limpio desde cero en vez de dejar la descarga inservible para siempre.
      await clearPartial(input.key);
      await removeFile(temporary);
      result = await attempt(undefined);
    }

    if (!result?.uri) {
      if (input.control?.cancelled) {
        await clearPartial(input.key);
        await removeFile(temporary);
        throw new Error('Descarga cancelada.');
      }
      throw new Error('La descarga no devolvió un archivo.');
    }

    await removeFile(destination);
    await FileSystem.moveAsync({ from: result.uri, to: destination });
    await clearPartial(input.key);

    const downloadedAt = Date.now();
    const entry: OfflineVideo = {
      key: input.key,
      uri: destination,
      title: input.title,
      downloadedAt,
      expiresAt: downloadedAt + EXPIRATION_MS,
      ...(input.audioTrackName ? { audioTrackName: input.audioTrackName } : {}),
      ...(typeof input.audioTrackIndex === 'number' &&
      input.audioTrackIndex >= 0
        ? { audioTrackIndex: input.audioTrackIndex }
        : {}),
    };
    const list = (await readMetadata()).filter(
      (item) => item.key !== input.key,
    );
    await writeMetadata([entry, ...list]);
    return entry;
  } finally {
    backgroundSubscription.remove();
    activeDownload = null;
  }
}
