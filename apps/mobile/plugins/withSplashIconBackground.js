const { withAndroidStyles } = require('expo/config-plugins');

/**
 * Android 12+ pinta el icono del splash dentro de un círculo y, si el tema no
 * define `windowSplashScreenIconBackgroundColor`, usa un fondo claro (se veía
 * un disco gris detrás del logo). Lo forzamos al mismo negro del splash para
 * que el logo quede sobre fondo negro.
 *
 * expo-splash-screen no expone esta opción, así que la añadimos al estilo
 * `Theme.App.SplashScreen` después de que Expo lo genere.
 */
module.exports = function withSplashIconBackground(config) {
  return withAndroidStyles(config, (config) => {
    const { resources } = config.modResults;
    const style = (resources.style ?? []).find(
      (entry) => entry.$?.name === 'Theme.App.SplashScreen'
    );
    if (!style) return config;

    const items = style.item ?? [];
    style.item = [
      ...items.filter(
        (item) => item.$?.name !== 'windowSplashScreenIconBackgroundColor'
      ),
      {
        $: { name: 'windowSplashScreenIconBackgroundColor' },
        _: '@color/splashscreen_background',
      },
    ];
    return config;
  });
};
