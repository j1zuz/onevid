import { Stack } from 'expo-router';
import { COLORS } from '@/lib/theme';

export default function ProfilesLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: COLORS.background },
        animation: 'fade',
      }}
    />
  );
}
