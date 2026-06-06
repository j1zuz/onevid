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

  return { width, isTV, isLarge, posterColumns };
}
