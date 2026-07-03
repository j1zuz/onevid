import { PostHog } from 'posthog-react-native';
import { Platform } from 'react-native';

// Instancia ÚNICA de PostHog, compartida entre los componentes (montada vía
// <PostHogProvider client={posthog}> en _layout) y el código que NO es React
// (api.ts, callbacks del reproductor). Así todo captura en el mismo cliente y
// no se crean device IDs duplicados.
//
// Nota: al pasar `client` al provider, éste usa esta instancia tal cual y NO
// aplica sus defaults de autocapture; por eso las opciones (replay, ciclo de
// vida, error tracking) se declaran aquí.
export const posthog = new PostHog(
  process.env.EXPO_PUBLIC_POSTHOG_API_KEY ?? '',
  {
    host: process.env.EXPO_PUBLIC_POSTHOG_HOST,
    // Replay nativo desactivado en Android TV (el módulo no aplica ahí).
    enableSessionReplay: !Platform.isTV,
    captureAppLifecycleEvents: true,
    errorTracking: {
      autocapture: { uncaughtExceptions: true, unhandledRejections: true },
    },
  },
);

// Helper seguro para capturar eventos desde cualquier módulo. Nunca lanza: la
// telemetría jamás debe romper un flujo de la app.
export function track(
  event: string,
  properties?: Record<string, unknown>,
): void {
  try {
    posthog.capture(event, properties as Parameters<PostHog['capture']>[1]);
  } catch {
    /* noop: no romper la app por telemetría */
  }
}
