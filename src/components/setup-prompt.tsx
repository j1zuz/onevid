import { useQuery } from '@tanstack/react-query';
import { Typography } from 'heroui-native';
import { CloudOff } from 'lucide-react-native';
import { View } from 'react-native';
import { apiFetch } from '@/lib/api';
import { API_URL } from '@/lib/auth';
import { COLORS } from '@/lib/theme';

export interface SetupStatus {
  setupCompleted: boolean;
  hasTmdbToken: boolean;
  hasTorboxKey: boolean;
  addonsCount: number;
}

export const SETUP_URL = `${API_URL}/home/projects/1vid`;

/**
 * Estado de configuración de 1vid. Comparte la key ['setup-status'] entre todas
 * las pestañas, así que un solo fetch sirve para Inicio, Descubrir y Biblioteca.
 */
export function useSetupStatus() {
  return useQuery({
    queryKey: ['setup-status'],
    queryFn: () => apiFetch<SetupStatus>('/api/onevid-setup-complete'),
  });
}

/** Pantalla completa que pide completar la configuración en la web. */
export function SetupPrompt() {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: COLORS.background,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 32,
        gap: 16,
      }}
    >
      <CloudOff size={48} color="#888" />
      <Typography type="h5" align="center">
        Configura 1vid para empezar
      </Typography>
      <Typography type="body-sm" color="muted" align="center">
        Aún no completaste la configuración.
      </Typography>
      <Typography type="body-sm" color="muted" align="center">
        Sigue los pasos en:
      </Typography>
      <Typography type="body-sm" align="center">
        {SETUP_URL}
      </Typography>
    </View>
  );
}
