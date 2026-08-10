import { Redirect } from 'expo-router';
import { View } from 'react-native';
import { useAppSurface } from '@/hooks/use-app-surface';
import { COLORS } from '@/lib/theme';

// Puerta de entrada en arranque en frío (la app se lanza en "/"). En modo stream
// con sesión mandamos SIEMPRE a la selección de perfil (estilo Netflix): así, en
// cada arranque, el usuario elige perfil antes de ver el Inicio en vez de saltar
// directo al home del último perfil. Sin sesión, o en modo local, vamos directo
// al tab Inicio (que ya resuelve "Reproducir video" / login).
export default function Index() {
  const surface = useAppSurface();
  // `surface` se siembra sincrónicamente en _layout (validateSession + loadAppMode
  // ya resueltos al montar), así que normalmente no es null aquí; el guard evita
  // decidir la ruta con datos incompletos si se montara antes de sembrarse.
  if (surface == null)
    return <View style={{ flex: 1, backgroundColor: COLORS.background }} />;
  // showLocal === false ⇒ modo stream con sesión (ver computeSurface).
  if (surface.authed && !surface.showLocal) return <Redirect href="/profiles" />;
  return <Redirect href="/home" />;
}
