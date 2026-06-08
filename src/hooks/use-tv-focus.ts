import { useState } from 'react';
import { Platform, type ViewStyle } from 'react-native';

const RING_COLOR = '#4f9dff';

/**
 * Foco visible en Android TV. HeroUI no trae estado de foco, así que lo
 * añadimos: en TV los componentes basados en Pressable/Button/PressableFeedback
 * exponen onFocus/onBlur; con eso marcamos el elemento enfocado.
 *
 * - `focused`: si el elemento tiene el foco (siempre false fuera de TV).
 * - `focusProps`: { onFocus, onBlur } a esparcir en el Pressable/Button (vacío
 *   fuera de TV).
 */
export function useTvFocus() {
  const [focused, setFocused] = useState(false);
  if (!Platform.isTV) {
    return { focused: false, focusProps: {} as Record<string, never> };
  }
  return {
    focused,
    focusProps: {
      onFocus: () => setFocused(true),
      onBlur: () => setFocused(false),
    },
  };
}

/**
 * Estilo de anillo de foco para TV: solo borde (transparente fijo para no
 * desplazar el layout; azul al enfocar). NO usamos `transform`/scale porque
 * Button y PressableFeedback de HeroUI ya animan su propio transform y mezclar
 * otro rompe el estilo (TypeError forEach). Fuera de TV devuelve null.
 */
export function tvFocusRing(focused: boolean): ViewStyle | null {
  if (!Platform.isTV) return null;
  return {
    borderWidth: 3,
    borderColor: focused ? RING_COLOR : 'transparent',
  };
}
