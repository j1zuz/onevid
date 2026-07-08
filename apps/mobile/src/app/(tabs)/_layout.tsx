import { Image } from 'expo-image';
import { Tabs } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, View } from 'react-native';
import { TabIcon, type TabIconName } from '@/components/tab-icon';
import { TvSidebar } from '@/components/tv-sidebar';
import { avatarSource } from '@/lib/avatars';
import { loadActiveProfile } from '@/lib/profiles';
import { COLORS } from '@/lib/theme';

function icon(name: TabIconName) {
  return ({ focused, size }: { focused: boolean; size: number }) => (
    <TabIcon name={name} focused={focused} size={size} />
  );
}

// Ícono del tab "Perfil": el avatar del perfil activo (en vez de un ícono fijo).
function profileIcon(avatar: string | undefined) {
  return ({ focused, size }: { focused: boolean; size: number }) => {
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
}

export default function TabsLayout() {
  const { t } = useTranslation();
  const [avatar, setAvatar] = useState<string | undefined>(undefined);
  useEffect(() => {
    loadActiveProfile().then((p) => setAvatar(p?.avatar)).catch(() => {});
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <Tabs
        // En TV ocultamos los tabs inferiores; la navegación se hace con el
        // rail lateral (overlay) que no inseta ni deja borde visible.
        tabBar={Platform.isTV ? () => null : undefined}
        screenOptions={{
          headerShown: false,
          tabBarStyle: {
            backgroundColor: COLORS.background,
            borderTopColor: '#222',
          },
          sceneStyle: { backgroundColor: COLORS.background },
          tabBarActiveTintColor: '#fff',
          tabBarInactiveTintColor: '#9ca3af',
        }}
      >
        <Tabs.Screen
          name="home"
          options={{ title: t('Inicio'), tabBarIcon: icon('home') }}
        />
        <Tabs.Screen
          name="discover"
          options={{ title: t('Descubrir'), tabBarIcon: icon('discover') }}
        />
        <Tabs.Screen
          name="library"
          options={{ title: t('Biblioteca'), tabBarIcon: icon('library') }}
        />
        <Tabs.Screen
          name="settings"
          options={{ title: t('Perfil'), tabBarIcon: profileIcon(avatar) }}
        />
      </Tabs>

      {Platform.isTV ? <TvSidebar /> : null}
    </View>
  );
}
