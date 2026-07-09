const { getPostHogExpoConfig } = require('posthog-react-native/metro');
const { withUniwindConfig } = require('uniwind/metro');

// getPostHogExpoConfig envuelve getDefaultConfig (habilita subida de source maps
// para error tracking) y le seguimos aplicando la config de uniwind encima.
const config = getPostHogExpoConfig(__dirname);

module.exports = withUniwindConfig(config, {
  cssEntryFile: './src/global.css',
  dtsFile: './uniwind-types.d.ts',
});
