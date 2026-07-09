import { Typography } from 'heroui-native';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { COLORS } from '@/lib/theme';

/**
 * Estado vacío centrado (icono + título + descripción). Se usa, p. ej., en los
 * tabs que solo aplican al modo Stream cuando no hay sesión.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  /** Botón/acción opcional, centrado bajo la descripción. */
  action?: ReactNode;
}) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: COLORS.background,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 40,
        gap: 12,
      }}
    >
      {icon ? (
        <View
          style={{
            width: 72,
            height: 72,
            borderRadius: 999,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: COLORS.surface,
            marginBottom: 4,
          }}
        >
          {icon}
        </View>
      ) : null}
      <Typography type="h5" align="center">
        {title}
      </Typography>
      {description ? (
        <Typography type="body-sm" color="muted" align="center">
          {description}
        </Typography>
      ) : null}
      {action ? <View style={{ marginTop: 8 }}>{action}</View> : null}
    </View>
  );
}
