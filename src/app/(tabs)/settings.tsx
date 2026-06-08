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
import { type ComponentProps, useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiFetch } from '@/lib/api';
import { clearAccessToken } from '@/lib/auth';
import { useTvFocus, tvFocusRing } from '@/hooks/use-tv-focus';
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
          <>
            {/* Tarjeta de perfil (avatar + Perfil/nombre + Cambiar) */}
            <Card>
              <Card.Body className="flex-row items-center gap-4">
                <Skeleton style={{ width: 56, height: 56, borderRadius: 14 }} />
                <View style={{ flex: 1, gap: 6 }}>
                  <Skeleton style={{ width: 44, height: 12, borderRadius: 4 }} />
                  <Skeleton style={{ width: 110, height: 20, borderRadius: 4 }} />
                </View>
                <Skeleton style={{ width: 56, height: 16, borderRadius: 4 }} />
              </Card.Body>
            </Card>

            {/* Lista Email / Usuario (icono + título + descripción) */}
            <Card>
              <Card.Body className="gap-0">
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 16,
                    paddingVertical: 8,
                  }}
                >
                  <Skeleton style={{ width: 36, height: 36, borderRadius: 10 }} />
                  <View style={{ gap: 6 }}>
                    <Skeleton style={{ width: 60, height: 14, borderRadius: 4 }} />
                    <Skeleton style={{ width: 170, height: 12, borderRadius: 4 }} />
                  </View>
                </View>
                <Separator className="mx-4" />
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 16,
                    paddingVertical: 8,
                  }}
                >
                  <Skeleton style={{ width: 36, height: 36, borderRadius: 10 }} />
                  <View style={{ gap: 6 }}>
                    <Skeleton style={{ width: 70, height: 14, borderRadius: 4 }} />
                    <Skeleton style={{ width: 90, height: 12, borderRadius: 4 }} />
                  </View>
                </View>
              </Card.Body>
            </Card>
          </>
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
              <Pressable
                onPress={handleSwitchProfile}
                style={(s) => [
                  { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999 },
                  tvFocusRing((s as { focused?: boolean }).focused ?? false),
                ]}
              >
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

        <FocusButton onPress={handleLogout} variant="secondary">
          Cerrar sesión
        </FocusButton>
      </ScrollView>
    </SafeAreaView>
  );
}

// Button de HeroUI con anillo de foco para TV (en móvil tvFocusRing es null).
function FocusButton({ children, style, ...props }: ComponentProps<typeof Button>) {
  const { focused, focusProps } = useTvFocus();
  return (
    <Button {...props} {...focusProps} style={[style, tvFocusRing(focused)]}>
      {children}
    </Button>
  );
}
