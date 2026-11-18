import { Image } from 'expo-image';
import { Tabs, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { TabIcon, type TabIconName } from '@/components/tab-icon';
import { TvSidebar } from '@/components/tv-sidebar';
import { useActiveProfile } from '@/hooks/use-active-profile';
import { useAppSurface } from '@/hooks/use-app-surface';
import { track } from '@/lib/analytics';
import { avatarSource } from '@/lib/avatars';
import {
  getActiveProfileSnapshot,
  refreshActiveProfile,
} from '@/lib/profiles';
import { COLORS } from '@/lib/theme';

function icon(name: TabIconName) {
  const TabIconComponent = ({
    focused,
    size,
  }: {
    focused: boolean;
    size: number;
  }) => (
    <TabIcon name={name} focused={focused} size={size} />
  );
  TabIconComponent.displayName = `TabIcon(${name})`;
  return TabIconComponent;
}

/**
 * Ícono del tab "Perfil": el avatar del perfil activo (en vez de un ícono fijo).
 *
 * Lee el perfil DENTRO del componente, con su propia suscripción. Antes el
 * avatar llegaba por `options` (`tabBarIcon: profileIcon(avatar)`): si el
 * navegador no volvía a evaluar el ícono —o si el aviso de "perfil elegido"
 * llegaba antes de que el layout existiera— se quedaba el avatar negro por
 * defecto aunque el perfil ya estuviera seleccionado y Configuración mostrara
 * el correcto.
 */
const ProfileTabIcon = ({
  focused,
  size,
}: {
  focused: boolean;
  size: number;
}) => {
  const profile = useActiveProfile();
  const d = size + 4;
  return (
    <Image
      source={avatarSource(profile?.avatar)}
      style={{
        width: d,
        height: d,
        borderRadius: d / 2,
        opacity: focused ? 1 : 0.55,
        borderWidth: focused ? 2 : 0,
        borderColor: '#fff',
      }}
    />
  );
};
ProfileTabIcon.displayName = 'ProfileTabIcon';

export default function TabsLayout() {
  const { t } = useTranslation();
  // Avatar del tab Perfil: SOLO refleja el perfil cuando hay sesión. Sin sesión
  // (modo local) mostramos siempre el avatar negro por defecto — aunque quede un
  // perfil guardado de una sesión anterior en SecureStore. `authed` viene del
  // AppSurface compartido (ya revalida en cada focus); el perfil se relee aparte
  // porque no es parte de AppSurface.
  const surface = useAppSurface();
  const authed = surface?.authed ?? false;
  // Cambio de pestaña con un desplazamiento suave en móvil; en TV (sin tab bar,
  // se navega con el rail) y con "reducir movimiento" se cambia en seco.
  const reduceMotion = useReducedMotion();
  // Al montar los tabs se relee el perfil activo aunque el aviso de
  // "perfil elegido" haya llegado antes de que el layout existiera. El icono
  // del tab ya se suscribe por su cuenta al snapshot; esto solo garantiza que
  // el snapshot esté cargado y deja una medición para saber si el avatar llegó.
  useEffect(() => {
    if (!authed) return;
    const startedAt = Date.now();
    const hadSnapshot = Boolean(getActiveProfileSnapshot());
    let cancelled = false;
    refreshActiveProfile()
      .catch(() => null)
      .then((p) => {
        if (cancelled) return;
        try {
          track('profile_avatar_tab', {
            had_snapshot: hadSnapshot,
            resolved: Boolean(p?.avatar),
            delay_ms: Date.now() - startedAt,
          });
        } catch {
          // La analítica nunca debe romper la navegación.
        }
      });
    return () => {
      cancelled = true;
    };
  }, [authed]);

  useFocusEffect(
    useCallback(() => {
      if (!authed) {
        return;
      }
      // `refreshActiveProfile` relee del backend cuando hay red: el avatar
      // puede haberse cambiado desde otro dispositivo (la web comparte cuenta)
      // y la copia local se quedaba con el anterior. Si cambió, avisa a los
      // suscriptores y el icono se repinta solo.
      void refreshActiveProfile().catch(() => undefined);
    }, [authed]),
  );

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <Tabs
        // En TV ocultamos los tabs inferiores; la navegación se hace con el
        // rail lateral (overlay) que no inseta ni deja borde visible.
        tabBar={Platform.isTV ? () => null : undefined}
        screenOptions={{
          headerShown: false,
          // Solo iconos: sin el texto (Inicio, Descubrir…) la barra queda más
          // limpia y recupera altura para el contenido. El nombre de cada
          // pestaña se mantiene para lectores de pantalla
          // (`tabBarAccessibilityLabel`).
          tabBarShowLabel: false,
          tabBarStyle: {
            backgroundColor: COLORS.background,
            borderTopColor: '#222',
          },
          sceneStyle: { backgroundColor: COLORS.background },
          animation:
            Platform.isTV || reduceMotion ? 'none' : 'shift',
          tabBarActiveTintColor: '#fff',
          tabBarInactiveTintColor: '#9ca3af',
        }}
      >
        <Tabs.Screen
          name="home"
          options={{
            title: t('Inicio'),
            tabBarAccessibilityLabel: t('Inicio'),
            tabBarIcon: icon('home'),
          }}
        />
        <Tabs.Screen
          name="discover"
          options={{
            title: t('Descubrir'),
            tabBarAccessibilityLabel: t('Descubrir'),
            tabBarIcon: icon('discover'),
          }}
        />
        <Tabs.Screen
          name="live"
          options={{
            title: t('Live TV'),
            tabBarAccessibilityLabel: t('Live TV'),
            tabBarIcon: icon('live'),
          }}
        />
        <Tabs.Screen
          name="library"
          options={{
            title: t('Biblioteca'),
            tabBarAccessibilityLabel: t('Biblioteca'),
            tabBarIcon: icon('library'),
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: t('Perfil'),
            tabBarAccessibilityLabel: t('Perfil'),
            tabBarIcon: ProfileTabIcon,
          }}
        />
      </Tabs>

      {Platform.isTV ? <TvSidebar /> : null}
    </View>
  );
}
