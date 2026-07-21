import { CheckCircle2 } from 'lucide-react-native';
import { useToast } from 'heroui-native';
import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type DeviceCodeData,
  pollDeviceToken,
  requestDeviceCode,
  saveAccessToken,
} from '@/lib/auth';
import { setAppMode } from '@/lib/app-mode';

export type LoginPhase = 'loading' | 'waiting' | 'denied' | 'expired' | 'error';

const COUNTDOWN_SECONDS = 5 * 60; // 5 minutos

export interface DeviceLogin {
  phase: LoginPhase;
  codeData: DeviceCodeData | null;
  errorMessage: string | null;
  secondsLeft: number;
  requestCode: () => Promise<void>;
  handleCopyCode: () => Promise<void>;
}

/**
 * Lógica del login por código de dispositivo (device-code flow): pide un código,
 * hace polling hasta la aprobación y mantiene el contador de expiración. Solo
 * corre mientras `active`. Al aprobar guarda el token y llama `onApproved`.
 * La comparten el drawer (móvil) y la pantalla centrada (TV).
 */
export function useDeviceLogin(
  active: boolean,
  onApproved: () => void,
): DeviceLogin {
  const [phase, setPhase] = useState<LoginPhase>('loading');
  const [codeData, setCodeData] = useState<DeviceCodeData | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(COUNTDOWN_SECONDS);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { toast } = useToast();
  // Ref para no atar los effects de polling a una nueva función cada render.
  const onApprovedRef = useRef(onApproved);
  useEffect(() => {
    onApprovedRef.current = onApproved;
  });

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

  // Pide un código nuevo cuando se activa; al desactivarse, para.
  useEffect(() => {
    if (!active) {
      clearTimer();
      return;
    }
    requestCode();
    return clearTimer;
  }, [active, requestCode, clearTimer]);

  // Polling al backend mientras esperamos la aprobación.
  useEffect(() => {
    if (!active || phase !== 'waiting' || !codeData) return;
    let intervalSeconds = codeData.interval || 5;
    let cancelled = false;

    async function poll() {
      if (cancelled || !codeData) return;
      const outcome = await pollDeviceToken(codeData.device_code);
      if (cancelled) return;
      if (outcome.kind === 'approved') {
        await saveAccessToken(outcome.token.access_token);
        // Al iniciar sesión pasamos SIEMPRE a modo stream: si el usuario venía de
        // "Continuar sin cuenta", quedó persistido mode:'local', y en TV showLocal
        // depende solo del modo (no de authed), así que sin esto se quedaría en la
        // experiencia local pese a haber iniciado sesión.
        await setAppMode('stream');
        onApprovedRef.current();
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
  }, [active, phase, codeData, clearTimer]);

  // Contador regresivo de 5 minutos: al llegar a 0 regenera código.
  useEffect(() => {
    if (!active || phase !== 'waiting' || !codeData) return;
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
  }, [active, phase, codeData, requestCode]);

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

  return { phase, codeData, errorMessage, secondsLeft, requestCode, handleCopyCode };
}
