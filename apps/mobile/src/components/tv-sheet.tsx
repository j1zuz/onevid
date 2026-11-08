import type { ComponentRef, ReactNode, RefObject } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { COLORS } from '@/lib/theme';

type TvFocusTarget = {
  requestTVFocus?: () => void;
  focus?: () => void;
} | null;

/**
 * Bottom sheet para Android TV.
 *
 * Los `BottomSheet` de HeroUI se montan en un portal de JS dentro del árbol de
 * la app (no en una ventana propia), así que la pantalla de atrás sigue siendo
 * enfocable y el D-pad seleccionaba items del fondo con el sheet abierto.
 *
 * En TV usamos un `Modal` de RN: crea una ventana de diálogo, así que el foco
 * queda aislado del contenido de atrás. Aun así Android no le da foco a ningún
 * hijo al abrir (la ventana aparece sin vista enfocada y el D-pad no responde),
 * por eso `firstFocusRef` recibe el foco explícitamente en `onShow`.
 *
 * En móvil no se usa: cada pantalla mantiene su `BottomSheet` de HeroUI.
 */
export function TvSheet({
  visible,
  onClose,
  children,
  contentStyle,
  firstFocusRef,
}: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
  /** Primer elemento que debe recibir el foco al abrir el sheet. */
  firstFocusRef?: RefObject<ComponentRef<typeof View> | null>;
}) {
  if (!Platform.isTV) return null;

  const focusFirst = () => {
    let attempts = 0;

    const attempt = () => {
      const target = firstFocusRef?.current as unknown as TvFocusTarget;
      // `requestTVFocus` es el comando nativo de RN-TVs (`View.requestFocus`);
      // `focus()` depende de un feature flag apagado por defecto.
      if (target?.requestTVFocus) {
        target.requestTVFocus();
        return;
      }
      if (target?.focus) {
        target.focus();
        return;
      }
      if (attempts++ < 15) setTimeout(attempt, 100);
    };

    setTimeout(attempt, 120);
  };

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      onShow={focusFirst}
      statusBarTranslucent
      transparent
      visible={visible}
    >
      <View style={styles.backdrop}>
        {/* Tocar fuera cierra. No enfocable: el D-pad no debe caer aquí. */}
        <Pressable
          accessibilityLabel="Cerrar"
          focusable={false}
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View style={[styles.sheet, contentStyle]}>{children}</View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.65)',
  },
  sheet: {
    maxHeight: '78%',
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 12,
    paddingBottom: 16,
  },
});
