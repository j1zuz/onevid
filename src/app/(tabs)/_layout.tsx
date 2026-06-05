import { Tabs } from 'expo-router';
import { TabIcon, type TabIconName } from '@/components/tab-icon';
import { COLORS } from '@/lib/theme';

function icon(name: TabIconName) {
  return ({ focused, size }: { focused: boolean; size: number }) => (
    <TabIcon name={name} focused={focused} size={size} />
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
        tabBarActiveTintColor: '#fff',
        tabBarInactiveTintColor: '#9ca3af',
      }}
    >
      <Tabs.Screen
        name="home"
        options={{ title: 'Inicio', tabBarIcon: icon('home') }}
      />
      <Tabs.Screen
        name="discover"
        options={{ title: 'Descubrir', tabBarIcon: icon('discover') }}
      />
      <Tabs.Screen
        name="library"
        options={{ title: 'Biblioteca', tabBarIcon: icon('library') }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: 'Configuración', tabBarIcon: icon('settings') }}
      />
    </Tabs>
  );
}
