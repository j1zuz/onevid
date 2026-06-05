import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { GlassIcon } from '@/components/glass-icon';
import {
  Button,
  Card,
  ListGroup,
  Separator,
  Skeleton,
  Typography,
} from 'heroui-native';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiFetch } from '@/lib/api';
import { clearAccessToken } from '@/lib/auth';
import { avatarSource } from '@/lib/avatars';
import {
  clearActiveProfile,
  loadActiveProfile,
  type Profile,
} from '@/lib/profiles';
import { COLORS } from '@/lib/theme';

interface SessionUser {
  id: string;
  email: string;
  name?: string | null;
  username?: string | null;
  image?: string | null;
}

interface SessionResponse {
  user: SessionUser;
}

export default function SettingsTab() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  useFocusEffect(
    useCallback(() => {
      loadActiveProfile()
        .then(setProfile)
        .catch(() => undefined);
    }, []),
  );

  const handleSwitchProfile = useCallback(async () => {
    await clearActiveProfile();
    router.replace('/profiles');
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiFetch<SessionResponse | null>('/api/auth/get-session')
      .then((data) => {
        if (!cancelled) setUser(data?.user ?? null);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Error de sesión');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleLogout = async () => {
    await clearActiveProfile();
    await clearAccessToken();
    router.replace('/');
  };

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: COLORS.background }}
      edges={['top']}
    >
      <ScrollView contentContainerClassName="gap-6 px-4 py-6">
        <View className="gap-1">
          <Typography type="h2">Configuración</Typography>
          <Typography type="body" color="muted">
            Tu cuenta y preferencias
          </Typography>
        </View>

        {loading ? (
          <View style={{ gap: 16 }}>
            <Skeleton style={{ height: 88, borderRadius: 16 }} />
            <Skeleton style={{ height: 130, borderRadius: 16 }} />
          </View>
        ) : null}

        {error ? (
          <Card>
            <Card.Body>
              <Typography type="body-sm" color="muted">
                {error}
              </Typography>
            </Card.Body>
          </Card>
        ) : null}

        {profile && !loading ? (
          <Card>
            <Card.Body className="flex-row items-center gap-4">
              <Image
                source={avatarSource(profile.avatar)}
                style={{ width: 56, height: 56, borderRadius: 14 }}
                contentFit="cover"
              />
              <View className="flex-1 gap-0.5">
                <Typography type="body-xs" color="muted">
                  Perfil
                </Typography>
                <Typography type="h5">{profile.name}</Typography>
              </View>
              <Pressable onPress={handleSwitchProfile}>
                <Typography
                  type="body-sm"
                  weight="medium"
                  style={{ color: '#3b82f6' }}
                >
                  Cambiar
                </Typography>
              </Pressable>
            </Card.Body>
          </Card>
        ) : null}

        {user && !loading ? (
          <>
            <ListGroup>
              <ListGroup.Item>
                <ListGroup.ItemPrefix>
                  <GlassIcon name="inbox" size={24} />
                </ListGroup.ItemPrefix>
                <ListGroup.ItemContent>
                  <ListGroup.ItemTitle>Email</ListGroup.ItemTitle>
                  <ListGroup.ItemDescription>
                    {user.email}
                  </ListGroup.ItemDescription>
                </ListGroup.ItemContent>
              </ListGroup.Item>
              <Separator className="mx-4" />
              <ListGroup.Item>
                <ListGroup.ItemPrefix>
                  <GlassIcon name="badge-sparkle" size={24} />
                </ListGroup.ItemPrefix>
                <ListGroup.ItemContent>
                  <ListGroup.ItemTitle>Usuario</ListGroup.ItemTitle>
                  <ListGroup.ItemDescription>
                    {user.username ?? '—'}
                  </ListGroup.ItemDescription>
                </ListGroup.ItemContent>
              </ListGroup.Item>
            </ListGroup>
          </>
        ) : null}

        <Button onPress={handleLogout} variant="secondary">
          Cerrar sesión
        </Button>
      </ScrollView>
    </SafeAreaView>
  );
}
