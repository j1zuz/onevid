import * as Application from 'expo-application';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';
import { isDevelopmentBuild } from './app-variant';
import { API_URL, appClientHeaders } from './auth';

/**
 * Actualizaciones de la app Android fuera de la tienda.
 *
 * El backend (`/api/onevid-app-update`) devuelve la última versión publicada en
 * el release fijo de GitHub. Si es más nueva que la instalada, `checkAppUpdate`
 * la devuelve y la pantalla `/update` ofrece descargarla e instalarla.
 *
 * Solo tiene sentido en Android y en la variante Dev: la de producción se
 * actualiza desde la tienda. En iOS no hay sideload, así que no aplica.
 */

export interface AppUpdateInfo {
  version: string;
  url: string;
  notes?: string;
}

/** Compara versiones semver simples ("1.2.3", con o sin prefijo "v"). */
export function isVersionNewer(remote: string, installed: string): boolean {
  const parse = (value: string) =>
    value
      .trim()
      .replace(/^v/i, '')
      .split(/[-+]/)[0]
      .split('.')
      .map((part) => Number.parseInt(part, 10) || 0);
  const a = parse(remote);
  const b = parse(installed);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const next = a[index] ?? 0;
    const current = b[index] ?? 0;
    if (next > current) return true;
    if (next < current) return false;
  }
  return false;
}

export function installedAppVersion(): string {
  return Application.nativeApplicationVersion ?? '0.0.0';
}

// En Android TV no hay instalador de APKs accesible: el aviso se omite y la
// app de TV se actualiza con adb/EAS.
export const canUpdateInApp =
  Platform.OS === 'android' && !Platform.isTV && isDevelopmentBuild;

/**
 * Pregunta al backend si hay una versión más nueva. Devuelve `null` cuando no
 * aplica (iOS, build de producción), no hay red o ya estamos al día.
 */
export async function checkAppUpdate(): Promise<AppUpdateInfo | null> {
  if (!canUpdateInApp) {
    return null;
  }
  try {
    const response = await fetch(
      `${API_URL}/api/onevid-app-update?variant=dev`,
      { headers: appClientHeaders() },
    );
    if (!response.ok) {
      return null;
    }
    const data = (await response.json()) as Partial<AppUpdateInfo> & {
      version?: string | null;
    };
    if (!data.version || !data.url) {
      return null;
    }
    return isVersionNewer(data.version, installedAppVersion())
      ? {
          version: data.version,
          url: data.url,
          notes: data.notes ?? '',
        }
      : null;
  } catch {
    return null;
  }
}

/**
 * Descarga el APK al cache y abre el instalador de Android.
 *
 * Si el intent falla (por ejemplo, el usuario todavía no permitió "instalar
 * apps desconocidas" para onevid), se cae al navegador con la URL del APK para
 * que la descarga no se pierda.
 */
export async function downloadAndInstallUpdate(
  update: AppUpdateInfo,
  onProgress?: (fraction: number) => void,
): Promise<'installer' | 'browser'> {
  const target = `${FileSystem.cacheDirectory}onevid-${update.version}.apk`;
  await FileSystem.deleteAsync(target, { idempotent: true }).catch(() => {
    /* si no existía, da igual */
  });

  const download = FileSystem.createDownloadResumable(
    update.url,
    target,
    {},
    (progress) => {
      if (progress.totalBytesExpectedToWrite > 0) {
        onProgress?.(
          progress.totalBytesWritten / progress.totalBytesExpectedToWrite,
        );
      }
    },
  );

  const result = await download.downloadAsync();
  if (!result?.uri) {
    throw new Error('No se pudo descargar el APK.');
  }

  try {
    const contentUri = await FileSystem.getContentUriAsync(result.uri);
    await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
      data: contentUri,
      flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
      type: 'application/vnd.android.package-archive',
    });
    return 'installer';
  } catch {
    // Sin permiso de instalación: al menos que el navegador descargue el APK.
    await Linking.openURL(update.url);
    return 'browser';
  }
}
