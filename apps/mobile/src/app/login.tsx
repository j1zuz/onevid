import { router } from 'expo-router';
import { useCallback } from 'react';
import { StreamLoginScreen } from '@/components/stream-login-screen';
import { useAppSurface } from '@/hooks/use-app-surface';
import { setAppMode } from '@/lib/app-mode';

/**
 * Login por código de dispositivo (QR + código, se aprueba en /device). Se abre
 * desde la bienvenida y, como en la web, permite seguir sin cuenta (modo local).
 */
export default function LoginScreen() {
  const surface = useAppSurface();

  const handleContinueWithoutAccount = useCallback(async () => {
    await setAppMode('local');
    await surface?.refresh();
    router.replace('/home');
  }, [surface]);

  return (
    <StreamLoginScreen onContinueWithoutAccount={handleContinueWithoutAccount} />
  );
}
