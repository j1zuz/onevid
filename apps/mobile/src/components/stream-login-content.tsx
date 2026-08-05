import { Button, Chip, Skeleton, Typography } from 'heroui-native';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
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
  const { t } = useTranslation();
  return (
    <View style={{ alignItems: 'center', gap: 20, alignSelf: 'stretch' }}>
      <View style={{ alignItems: 'center', gap: 4 }}>
        <Typography type="body" color="muted" align="center">
          {t('Escanea este QR, o ve a')}
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
          {/* QR dinámico que codifica la URL de verificación CON el código, así
              al escanearlo el móvil abre /device?user_code=... y el código queda
              autocompletado (antes era una imagen fija que no llevaba el código).
              Fondo blanco + padding para que sea escaneable. */}
          <View style={{ padding: 12, borderRadius: 16, backgroundColor: '#fff' }}>
            <QRCode
              value={`${API_URL}/device?user_code=${encodeURIComponent(codeData.user_code)}`}
              size={176}
              backgroundColor="#fff"
              color="#000"
            />
          </View>
          <View style={{ alignItems: 'center', gap: 10 }}>
            <Typography type="body-xs" color="muted" weight="medium">
              {t('INGRESA Y APRUEBA ESTE CÓDIGO')}
            </Typography>
            <Pressable onPress={handleCopyCode}>
              <Typography type="h2" weight="bold" color="default">
                {formatUserCode(codeData.user_code)}
              </Typography>
            </Pressable>
            <View style={{ alignSelf: 'center' }}>
              <Chip variant="soft" color="accent" size="sm">
                <Chip.Label>
                  {t('Se renueva en {{time}}', { time: formatCountdown(secondsLeft) })}
                </Chip.Label>
              </Chip>
            </View>
          </View>
        </View>
      ) : null}

      {phase === 'denied' ? (
        <Typography type="body" align="center" color="default">
          {t('Rechazaste el acceso desde tu navegador.')}
        </Typography>
      ) : null}

      {phase === 'expired' ? (
        <Typography type="body" color="muted" align="center">
          {t('El código expiró. Genera uno nuevo para continuar.')}
        </Typography>
      ) : null}

      {phase === 'error' && errorMessage ? (
        <Typography type="body" align="center" color="default">
          {errorMessage}
        </Typography>
      ) : null}

      {phase === 'denied' || phase === 'expired' || phase === 'error' ? (
        <Button onPress={requestCode}>{t('Generar nuevo código')}</Button>
      ) : null}
    </View>
  );
}
