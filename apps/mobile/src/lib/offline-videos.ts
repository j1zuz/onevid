import * as FileSystem from 'expo-file-system/legacy';

const EXPIRATION_MS = 24 * 60 * 60 * 1000;
const METADATA_FILE = `${FileSystem.documentDirectory ?? ''}onevid-offline-videos.json`;
const DOWNLOAD_DIRECTORY = `${FileSystem.documentDirectory ?? ''}offline/`;

export interface OfflineVideo {
  key: string;
  uri: string;
  title: string;
  downloadedAt: number;
  expiresAt: number;
}

export interface OfflineDownloadControl {
  cancelled: boolean;
  cancel: () => Promise<void>;
}

function fileNameForKey(key: string): string {
  const safeKey = encodeURIComponent(key).replace(/%/g, '_').slice(0, 180);
  return `onevid-${safeKey}.mp4`;
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
  return match;
}

export async function downloadOfflineVideo(input: {
  key: string;
  url: string;
  title: string;
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
  await removeFile(temporary);

  try {
    const download = FileSystem.createDownloadResumable(
      input.url,
      temporary,
      {},
      (progress) => {
        const expected = progress.totalBytesExpectedToWrite;
        const value =
          expected > 0 ? progress.totalBytesWritten / expected : 0;
        input.onProgress?.(Math.min(1, Math.max(0, value)));
      },
    );
    if (input.control) {
      input.control.cancelled = false;
      input.control.cancel = async () => {
        input.control!.cancelled = true;
        await download.cancelAsync();
      };
    }
    const result = await download.downloadAsync();
    if (!result?.uri) {
      if (input.control?.cancelled) {
        throw new Error('Descarga cancelada.');
      }
      throw new Error('La descarga no devolvió un archivo.');
    }

    await removeFile(destination);
    await FileSystem.moveAsync({ from: result.uri, to: destination });

    const downloadedAt = Date.now();
    const entry: OfflineVideo = {
      key: input.key,
      uri: destination,
      title: input.title,
      downloadedAt,
      expiresAt: downloadedAt + EXPIRATION_MS,
    };
    const list = (await readMetadata()).filter((item) => item.key !== input.key);
    await writeMetadata([entry, ...list]);
    return entry;
  } catch (error) {
    await removeFile(temporary);
    await removeFile(destination);
    throw error instanceof Error
      ? error
      : new Error('No se pudo completar la descarga.');
  }
}
