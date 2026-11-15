import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Variantes de app: Dev y Producción.
 *
 * Cada variante tiene su propio identificador nativo (bundle id en iOS, package
 * en Android), que es lo único que permite tenerlas instaladas **a la vez** en
 * el mismo dispositivo: un dispositivo solo guarda una app por identificador.
 * El identificador se hornea en el build nativo, así que no se puede cambiar
 * desde `expo start`, solo reconstruyendo (`eas build` o
 * `expo prebuild --clean`).
 *
 * `APP_VARIANT` elige la variante. Sin variable se asume `development`, para
 * que los comandos locales (`expo start`, `expo run:*`, `expo prebuild`) nunca
 * generen por accidente la identidad de producción: producción solo se obtiene
 * pidiéndola explícitamente.
 *
 * En `eas.json` cada perfil fija su `APP_VARIANT`; localmente se pone en el
 * shell (o en `.env.local`, aunque recuerda que ese archivo no viaja a EAS).
 *
 * `app.json` sigue siendo la capa base (valores estables); este archivo solo
 * sobreescribe lo que depende de la variante. Por eso siempre se hace spread de
 * `config` y de `config.ios` / `config.android`: sin eso se pierde todo lo
 * definido en `app.json`.
 */

type AppVariant = 'development' | 'production';

const APP_ID_PREFIX = 'tech.hackw.onevid';
const BASE_NAME = 'onevid';

function resolveVariant(): AppVariant {
  // Cualquier valor distinto de "production" cae en desarrollo: el default
  // seguro es nunca publicar con identidad de producción sin pedirlo.
  return process.env.APP_VARIANT === 'production'
    ? 'production'
    : 'development';
}

const variant = resolveVariant();

const ID_SUFFIX: Record<AppVariant, string> = {
  // tech.hackw.onevid.dev convive con tech.hackw.onevid en el mismo teléfono.
  development: '.dev',
  production: '',
};

const NAME_SUFFIX: Record<AppVariant, string> = {
  development: ' Dev',
  production: '',
};

// `null` = producción usa los iconos de `app.json` sin tocarlos.
const ICON: Record<AppVariant, string | null> = {
  development: './assets/images/onevid-icon-dev.png',
  production: null,
};

export default ({ config }: ConfigContext): ExpoConfig => {
  const name = `${config.name ?? BASE_NAME}${NAME_SUFFIX[variant]}`;
  const appId = `${APP_ID_PREFIX}${ID_SUFFIX[variant]}`;
  const icon = ICON[variant] ?? undefined;

  // `expo-dev-client` se declara aquí (y no en app.json) porque la opción
  // depende de la variante: solo el build de desarrollo debe responder al
  // scheme `exp+onevid` que genera el CLI. Si Producción también lo registrara,
  // el QR de `expo start` podría abrir la app de la tienda en vez del Dev.
  const plugins = (config.plugins ?? []).filter((plugin) => {
    const pluginName = Array.isArray(plugin) ? plugin[0] : plugin;
    return pluginName !== 'expo-dev-client';
  });

  return {
    ...config,
    slug: config.slug ?? BASE_NAME,
    name,
    ...(icon ? { icon } : {}),
    ios: {
      ...config.ios,
      bundleIdentifier: appId,
      ...(icon ? { icon } : {}),
    },
    android: {
      ...config.android,
      package: appId,
      ...(icon
        ? {
            icon,
            adaptiveIcon: {
              ...config.android?.adaptiveIcon,
              foregroundImage: icon,
            },
          }
        : {}),
    },
    plugins: [
      ...plugins,
      ['expo-dev-client', { addGeneratedScheme: variant === 'development' }],
    ],
    extra: {
      ...config.extra,
      // Solo informativo. Para saber la variante en runtime NO se usa esto: con
      // expo-dev-client el config se descarga del dev server y puede no coincidir
      // con la identidad del build. La fuente fiable es `applicationId`
      // (expo-application), ver src/lib/app-variant.ts.
      appVariant: variant,
    },
  };
};
