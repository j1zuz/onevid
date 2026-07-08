import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Typography } from 'heroui-native';
import { CloudOff } from 'lucide-react-native';
import { useState } from 'react';
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

export const SETUP_URL = `${API_URL}/home/projects/onevid`;

/**
 * Estado de configuración de onevid. Comparte la key ['setup-status'] entre todas
 * las pestañas, así que un solo fetch sirve para Inicio, Descubrir y Biblioteca.
 */
export function useSetupStatus(enabled = true) {
  return useQuery({
    queryKey: ['setup-status'],
    queryFn: () => apiFetch<SetupStatus>('/api/onevid-setup-complete'),
    enabled,
    // El estado de configuración cambia desde la web (hackw); no lo dejamos
    // cacheado 5 min como el catálogo: lo marcamos siempre "stale" y revalidamos
    // al montar para detectar enseguida cuando ya se configuró.
    staleTime: 0,
    refetchOnMount: 'always',
  });
}

/** Pantalla completa que pide completar la configuración en la web. */
export function SetupPrompt() {
  const queryClient = useQueryClient();
  const [checking, setChecking] = useState(false);

  // Vuelve a consultar el estado de configuración (y el catálogo) tras
  // configurar en la web, sin tener que reiniciar la app.
  const handleRecheck = async () => {
    if (checking) return;
    setChecking(true);
    try {
      await queryClient.invalidateQueries({ queryKey: ['setup-status'] });
      await queryClient.invalidateQueries({ queryKey: ['catalog'] });
    } finally {
      setChecking(false);
    }
  };

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
        Configura onevid para empezar
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
      <Button onPress={handleRecheck} isDisabled={checking}>
        {checking ? 'Comprobando…' : 'Ya lo configuré'}
      </Button>
    </View>
  );
}
