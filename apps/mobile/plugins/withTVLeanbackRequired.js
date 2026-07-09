// Importar desde `expo/config-plugins` (no `@expo/config-plugins`): `expo` es
// dependencia directa, así que el subpath resuelve siempre. Con pnpm,
// `@expo/config-plugins` NO está en la raíz y el worker de EAS falla con
// "Cannot find module '@expo/config-plugins'".
const { withAndroidManifest } = require('expo/config-plugins');

const LEANBACK = 'android.software.leanback';

// Funciones de hardware táctil que las TVs NO tienen. Deben declararse como NO
// requeridas o Google Play rechaza el AAB de Android TV ("Usos de hardware no
// admitidos": android.hardware.faketouch / touchscreen). El AAB las marca como
// requeridas implícitamente, así que las forzamos a required="false".
const NOT_REQUIRED_ON_TV = [
  'android.hardware.touchscreen',
  'android.hardware.faketouch',
];

function upsertFeature(features, name, required) {
  const existing = features.find((f) => f.$ && f.$['android:name'] === name);
  if (existing) {
    existing.$['android:required'] = required;
  } else {
    features.push({ $: { 'android:name': name, 'android:required': required } });
  }
}

/**
 * Ajusta el manifiesto del AAB de Android TV ("Únicamente para Android TV"):
 *
 * - REQUIERE leanback (`android.software.leanback` con `android:required="true"`).
 *   `@react-native-tvos/config-tv` lo añade como `required="false"` (pensado para
 *   un AAB adaptable phone+TV); aquí lo forzamos a `"true"`.
 * - Declara `android.hardware.touchscreen` y `android.hardware.faketouch` como
 *   `required="false"` (las TVs no tienen táctil); sin esto, Play rechaza el AAB.
 *
 * Solo actúa en builds de TV (`EXPO_TV`), así el AAB de teléfono NO se toca.
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

    upsertFeature(features, LEANBACK, 'true');
    for (const name of NOT_REQUIRED_ON_TV) {
      upsertFeature(features, name, 'false');
    }
    return cfg;
  });
};
