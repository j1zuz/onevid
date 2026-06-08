import { CheckCircle2 } from 'lucide-react-native';
import { Button, Chip, Skeleton, Typography, useToast } from 'heroui-native';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Pressable, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GodRaysBand } from '@/components/god-rays-band';
import {
  API_URL,
  type DeviceCodeData,
  pollDeviceToken,
  requestDeviceCode,
  saveAccessToken,
} from '@/lib/auth';
import { COLORS } from '@/lib/theme';

type Phase = 'loading' | 'waiting' | 'denied' | 'expired' | 'error';

const COUNTDOWN_SECONDS = 5 * 60; // 5 minutos

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

export default function Login() {
  const { height: windowHeight } = useWindowDimensions();
  const [phase, setPhase] = useState<Phase>('loading');
  const [codeData, setCodeData] = useState<DeviceCodeData | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(COUNTDOWN_SECONDS);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { toast } = useToast();

  const clearTimer = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const requestCode = useCallback(async () => {
    clearTimer();
    setPhase('loading');
    setErrorMessage(null);
    setCodeData(null);
    setSecondsLeft(COUNTDOWN_SECONDS);
    try {
      const data = await requestDeviceCode();
      setCodeData(data);
      setPhase('waiting');
    } catch (e) {
      setErrorMessage(
        e instanceof Error
          ? e.message
          : 'No pudimos contactar al servidor. Intenta de nuevo.',
      );
      setPhase('error');
    }
  }, [clearTimer]);

  useEffect(() => {
    requestCode();
    return clearTimer;
  }, [requestCode, clearTimer]);

  // Polling al backend
  useEffect(() => {
    if (phase !== 'waiting' || !codeData) return;
    let intervalSeconds = codeData.interval || 5;
    let cancelled = false;

    async function poll() {
      if (cancelled || !codeData) return;
      const outcome = await pollDeviceToken(codeData.device_code);
      if (cancelled) return;
      if (outcome.kind === 'approved') {
        await saveAccessToken(outcome.token.access_token);
        router.replace('/profiles');
        return;
      }
      if (outcome.kind === 'pending') {
        intervalSeconds += outcome.intervalDelta;
        pollTimerRef.current = setTimeout(poll, intervalSeconds * 1000);
        return;
      }
      if (outcome.kind === 'denied') {
        setPhase('denied');
        return;
      }
      if (outcome.kind === 'expired') {
        setPhase('expired');
        return;
      }
      setErrorMessage(outcome.message);
      setPhase('error');
    }

    pollTimerRef.current = setTimeout(poll, intervalSeconds * 1000);
    return () => {
      cancelled = true;
      clearTimer();
    };
  }, [phase, codeData, clearTimer]);

  // Contador regresivo de 5 minutos: al llegar a 0 regenera código
  useEffect(() => {
    if (phase !== 'waiting' || !codeData) return;
    setSecondsLeft(COUNTDOWN_SECONDS);
    const interval = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          requestCode();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [phase, codeData, requestCode]);

  const handleCopyCode = useCallback(async () => {
    if (!codeData) return;
    await Clipboard.setStringAsync(codeData.user_code);
    toast.show({
      variant: 'success',
      label: 'Código copiado',
      description: 'Pégalo en la página de aprobación.',
      icon: <CheckCircle2 size={20} color="#22c55e" />,
    });
  }, [codeData, toast]);

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: COLORS.background }}
      edges={['top', 'bottom']}
    >
      <GodRaysBand height={Math.round(windowHeight * 0.28)} />
      <View style={{ flex: 1 }} className="items-center justify-center px-6">
        <View className="w-full gap-10">
          <View className="items-center gap-3">
            <Typography type="h2" align="center" color="default">
              Inicia sesión
            </Typography>
            <View style={{ alignItems: 'center', gap: 4 }}>
              <Typography type="body" color="muted" align="center">
                Escanea este QR, o ve a
              </Typography>
              <Typography
                type="body"
                color="default"
                weight="medium"
                align="center"
              >
                {API_URL}/device
              </Typography>
            </View>
          </View>

          {phase === 'loading' ? (
            <View style={{ alignItems: 'center', gap: 16 }}>
              <Skeleton
                style={{ width: 220, height: 220, borderRadius: 16 }}
              />
              <Skeleton style={{ width: 200, height: 48, borderRadius: 8 }} />
              <Skeleton style={{ width: 140, height: 24, borderRadius: 999 }} />
            </View>
          ) : null}

          {phase === 'waiting' && codeData ? (
            <View style={{ alignItems: 'center', gap: 32 }}>
              <Image
                source={require('@/assets/images/qr-code.png')}
                style={{ width: 220, height: 220, borderRadius: 16 }}
                resizeMode="contain"
              />

              <View style={{ alignItems: 'center', gap: 12, alignSelf: 'stretch' }}>
                <Typography type="body-xs" color="muted" weight="medium">
                  INGRESA Y APRUEBA ESTE CÓDIGO
                </Typography>
                <Pressable onPress={handleCopyCode}>
                  <Typography type="h1" weight="bold" color="default">
                    {formatUserCode(codeData.user_code)}
                  </Typography>
                </Pressable>
                <View style={{ alignSelf: 'center' }}>
                  <Chip variant="soft" color="accent" size="sm">
                    <Chip.Label>
                      Se renueva en {formatCountdown(secondsLeft)}
                    </Chip.Label>
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
      </View>
    </SafeAreaView>
  );
}
