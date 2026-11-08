import { useEffect, useRef, useState } from 'react';
import {
  BackHandler,
  Keyboard,
  Platform,
  Pressable,
  TextInput,
  type TextInputInstance,
  type TextInputProps,
} from 'react-native';
import { tvFocusRing, useTvFocus } from '@/hooks/use-tv-focus';

/**
 * Campo de texto con D-pad para Android TV.
 *
 * En TV un `TextInput` enfocado se queda con las flechas del mando (mueve el
 * cursor) y BACK solo cierra el teclado: el foco no sale del campo y la
 * pantalla deja de responder. Aquí el input no es enfocable hasta que el
 * usuario pulsa OK sobre el campo; BACK sale del modo edición y devuelve el
 * foco al contenedor.
 *
 * Fuera de TV renderiza el `TextInput` tal cual.
 */
export function TvTextField({ style, ...props }: TextInputProps) {
  const isTV = Platform.isTV;
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<TextInputInstance>(null);
  const { focused, focusProps } = useTvFocus();

  useEffect(() => {
    if (!isTV || !editing) return;
    const timer = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(timer);
  }, [isTV, editing]);

  useEffect(() => {
    if (!isTV || !editing) return;
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        TextInput.State.currentlyFocusedInput?.()?.blur?.();
        inputRef.current?.blur();
        Keyboard.dismiss();
        setEditing(false);
        return true;
      },
    );
    return () => subscription.remove();
  }, [isTV, editing]);

  if (!isTV) return <TextInput {...props} style={style} />;

  return (
    <Pressable
      accessibilityRole="button"
      disabled={editing}
      onPress={() => setEditing(true)}
      {...focusProps}
      style={[{ borderRadius: 12, justifyContent: 'center' }, tvFocusRing(focused)]}
    >
      <TextInput
        {...props}
        editable={editing}
        focusable={editing}
        ref={inputRef}
        style={style}
      />
    </Pressable>
  );
}
