// Importar desde `expo/config-plugins` (no `@expo/config-plugins`): `expo` es
// dependencia directa, así que el subpath resuelve siempre. Con pnpm,
// `@expo/config-plugins` NO está en la raíz y el worker de EAS falla con
// "Cannot find module '@expo/config-plugins'".
const { withAndroidManifest } = require('expo/config-plugins');

const LEANBACK = 'android.software.leanback';

/**
 * La pista exclusiva de Android TV ("Únicamente para Android TV") exige que el
 * App Bundle REQUIERA leanback: `android.software.leanback` con
 * `android:required="true"`.
 *
 * `@react-native-tvos/config-tv` lo añade como `required="false"` (pensado para
 * un AAB adaptable phone+TV). Aquí lo forzamos a `"true"`.
 *
 * - Solo actúa en builds de TV (`EXPO_TV`), así el AAB de teléfono NO acaba
 *   exigiendo leanback.
 * - Añade la feature si no existe, o la corrige si ya existe → es independiente
 *   del orden de ejecución de los mods (los mods de manifest corren en orden
 *   inverso al del array de plugins; config-tv solo añade leanback "si falta",
 *   así que si lo dejamos en `true` primero, no lo pisa).
 */
module.exports = function withTVLeanbackRequired(config) {
  const isTV =
    process.env.EXPO_TV === '1' || process.env.EXPO_TV === 'true';
  if (!isTV) return config;

  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    if (!Array.isArray(manifest['uses-feature'])) {
      manifest['uses-feature'] = [];
    }
    const features = manifest['uses-feature'];
    const leanback = features.find(
      (f) => f.$ && f.$['android:name'] === LEANBACK,
    );
    if (leanback) {
      leanback.$['android:required'] = 'true';
    } else {
      features.push({
        $: { 'android:name': LEANBACK, 'android:required': 'true' },
      });
    }
    return cfg;
  });
};
