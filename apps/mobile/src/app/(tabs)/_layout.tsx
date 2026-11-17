import { Image } from 'expo-image';
import { Tabs, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { TabIcon, type TabIconName } from '@/components/tab-icon';
import { TvSidebar } from '@/components/tv-sidebar';
import { useAppSurface } from '@/hooks/use-app-surface';
import { avatarSource } from '@/lib/avatars';
import { refreshActiveProfile, subscribeActiveProfile } from '@/lib/profiles';
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

// Ícono del tab "Perfil": el avatar del perfil activo (en vez de un ícono fijo).
function profileIcon(avatar: string | undefined) {
  const ProfileIcon = ({
    focused,
    size,
  }: {
    focused: boolean;
    size: number;
  }) => {
    const d = size + 4;
    return (
      <Image
        source={avatarSource(avatar)}
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
  ProfileIcon.displayName = 'ProfileIcon';
  return ProfileIcon;
}

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
  const [avatar, setAvatar] = useState<string | undefined>(undefined);
  // Al editar el avatar se avisa desde `setActiveProfile`: así el tab se
  // actualiza al momento aunque la pestaña no vuelva a enfocarse.
  useEffect(
    () =>
      subscribeActiveProfile((p) => {
        if (!authed) return;
        setAvatar(p?.avatar);
      }),
    [authed],
  );
  // Al montar los tabs (justo después de elegir perfil) el evento
  // `setActiveProfile` ya ocurrió y `useFocusEffect` del layout no siempre
  // corre: el avatar se quedaba en negro. Leemos el perfil activo una vez aquí
  // y cada vez que cambia la sesión.
  useEffect(() => {
    if (!authed) return;
    let cancelled = false;
    refreshActiveProfile()
      .catch(() => null)
      .then((p) => {
        if (!cancelled) setAvatar(p?.avatar);
      });
    return () => {
      cancelled = true;
    };
  }, [authed]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      if (!authed) {
        setAvatar(undefined); // sin sesión → avatarSource(undefined) = black.jpg
        return;
      }
      // `refreshActiveProfile` relee del backend cuando hay red: el avatar
      // puede haberse cambiado desde otro dispositivo (la web comparte cuenta)
      // y la copia local se quedaba con el anterior.
      refreshActiveProfile()
        .catch(() => null)
        .then((p) => {
          if (!cancelled) setAvatar(p?.avatar);
        });
      return () => {
        cancelled = true;
      };
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
            tabBarIcon: profileIcon(avatar),
          }}
        />
      </Tabs>

      {Platform.isTV ? <TvSidebar /> : null}
    </View>
  );
}
