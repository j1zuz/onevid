import { Tabs } from 'expo-router';
import { Bookmark, Home, Search, Settings } from 'lucide-react-native';
import type { ColorValue } from 'react-native';
import type { ComponentType } from 'react';
import { COLORS } from '@/lib/theme';

type LucideIcon = ComponentType<{ color?: string; size?: number }>;

function tabIcon(Icon: LucideIcon) {
  return ({ color, size }: { color: ColorValue; size: number }) => (
    <Icon color={color as string} size={size} />
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: COLORS.background,
          borderTopColor: '#222',
        },
        sceneStyle: { backgroundColor: COLORS.background },
        tabBarActiveTintColor: '#3b82f6',
        tabBarInactiveTintColor: '#9ca3af',
      }}
    >
      <Tabs.Screen
        name="home"
        options={{ title: 'Inicio', tabBarIcon: tabIcon(Home) }}
      />
      <Tabs.Screen
        name="discover"
        options={{ title: 'Descubrir', tabBarIcon: tabIcon(Search) }}
      />
      <Tabs.Screen
        name="library"
        options={{ title: 'Biblioteca', tabBarIcon: tabIcon(Bookmark) }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: 'Configuración', tabBarIcon: tabIcon(Settings) }}
      />
    </Tabs>
  );
}
