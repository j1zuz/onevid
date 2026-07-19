import { Platform, useWindowDimensions } from 'react-native';

/**
 * Helper responsive para adaptar layouts a pantallas grandes / Android TV.
 *
 * Las props numéricas de React Native (p. ej. `numColumns` de FlatList o anchos)
 * no aceptan breakpoints de Uniwind (className), así que derivamos sus valores
 * del ancho de ventana aquí. Para estilos sí se usan los prefijos `lg:`/`xl:`.
 */
export function useResponsive() {
  const { width } = useWindowDimensions();
  const isTV = Platform.isTV;
  // En TV tratamos siempre como pantalla grande aunque el dp width varíe.
  const isLarge = isTV || width >= 1024;

  // Columnas para grids de pósters según el ancho disponible.
  const posterColumns =
    width >= 1280 ? 6 : width >= 1024 ? 5 : width >= 768 ? 4 : 2;

  // Ancho de póster en las filas horizontales (Inicio). En TV son más grandes.
  const posterWidth = isLarge ? 200 : 140;

  // Ancho de tarjeta horizontal (16:9) para TODAS las filas de catálogo
  // (Continuar viendo, Tendencias, Populares, Biblioteca) — deben verse del
  // mismo tamaño entre sí. Es la fórmula que ya usaba "Continuar viendo".
  const rowCardWidth = isTV
    ? Math.min(320, Math.max(180, Math.round((width - 32) / 5.3)))
    : Math.min(320, Math.max(200, Math.round((width - 32) / 2.4)));

  return { width, isTV, isLarge, posterColumns, posterWidth, rowCardWidth };
}
