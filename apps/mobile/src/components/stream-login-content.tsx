import { Button, Chip, Skeleton, Typography } from 'heroui-native';
import { Image, Pressable, View } from 'react-native';
import type { DeviceLogin } from '@/hooks/use-device-login';
import { API_URL } from '@/lib/auth';

function formatUserCode(code: string): string {
  if (code.length <= 4) return code;
  const mid = Math.ceil(code.length / 2);
  return `${code.slice(0, mid)}-${code.slice(mid)}`;
}

function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Bloque visual del login por QR (sin el título ni el chrome del contenedor):
 * la línea "Escanea este QR…", el QR, el código copiable, el contador y los
 * estados de error. Lo comparten el drawer (móvil) y la pantalla centrada (TV).
 */
export function StreamLoginContent({
  phase,
  codeData,
  errorMessage,
  secondsLeft,
  requestCode,
  handleCopyCode,
}: DeviceLogin) {
  return (
    <View style={{ alignItems: 'center', gap: 20, alignSelf: 'stretch' }}>
      <View style={{ alignItems: 'center', gap: 4 }}>
        <Typography type="body" color="muted" align="center">
          Escanea este QR, o ve a
        </Typography>
        <Typography type="body" color="default" weight="medium" align="center">
          {API_URL}/device
        </Typography>
      </View>

      {phase === 'loading' ? (
        <View style={{ alignItems: 'center', gap: 16, paddingVertical: 8 }}>
          <Skeleton style={{ width: 200, height: 200, borderRadius: 16 }} />
          <Skeleton style={{ width: 180, height: 44, borderRadius: 8 }} />
          <Skeleton style={{ width: 140, height: 24, borderRadius: 999 }} />
        </View>
      ) : null}

      {phase === 'waiting' && codeData ? (
        <View style={{ alignItems: 'center', gap: 20 }}>
          <Image
            source={require('@/assets/images/qr-code.png')}
            style={{ width: 200, height: 200, borderRadius: 16 }}
            resizeMode="contain"
          />
          <View style={{ alignItems: 'center', gap: 10 }}>
            <Typography type="body-xs" color="muted" weight="medium">
              INGRESA Y APRUEBA ESTE CÓDIGO
            </Typography>
            <Pressable onPress={handleCopyCode}>
              <Typography type="h2" weight="bold" color="default">
                {formatUserCode(codeData.user_code)}
              </Typography>
            </Pressable>
            <View style={{ alignSelf: 'center' }}>
              <Chip variant="soft" color="accent" size="sm">
                <Chip.Label>Se renueva en {formatCountdown(secondsLeft)}</Chip.Label>
              </Chip>
            </View>
          </View>
        </View>
      ) : null}

      {phase === 'denied' ? (
        <Typography type="body" align="center" color="default">
          Rechazaste el acceso desde tu navegador.
        </Typography>
      ) : null}

      {phase === 'expired' ? (
        <Typography type="body" color="muted" align="center">
          El código expiró. Genera uno nuevo para continuar.
        </Typography>
      ) : null}

      {phase === 'error' && errorMessage ? (
        <Typography type="body" align="center" color="default">
          {errorMessage}
        </Typography>
      ) : null}

      {phase === 'denied' || phase === 'expired' || phase === 'error' ? (
        <Button onPress={requestCode}>Generar nuevo código</Button>
      ) : null}
    </View>
  );
}
