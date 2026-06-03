import { AtSign, Fingerprint, Mail } from 'lucide-react-native';
import {
  Avatar,
  Button,
  Card,
  ListGroup,
  Separator,
  Skeleton,
  Typography,
} from 'heroui-native';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiFetch } from '@/lib/api';
import { clearAccessToken } from '@/lib/auth';
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
            <Skeleton style={{ height: 96, borderRadius: 16 }} />
            <Skeleton style={{ height: 200, borderRadius: 16 }} />
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

        {user ? (
          <>
            <Card>
              <Card.Body className="flex-row items-center gap-4">
                <Avatar alt={user.name ?? user.email} size="lg">
                  {user.image ? (
                    <Avatar.Image source={{ uri: user.image }} />
                  ) : null}
                  <Avatar.Fallback>
                    {(user.name ?? user.email).slice(0, 1).toUpperCase()}
                  </Avatar.Fallback>
                </Avatar>
                <View className="flex-1 gap-1">
                  <Typography type="h5">
                    {user.name ?? 'Sin nombre'}
                  </Typography>
                  <Typography type="body-sm" color="muted">
                    {user.email}
                  </Typography>
                </View>
              </Card.Body>
            </Card>

            <ListGroup>
              <ListGroup.Item>
                <ListGroup.ItemPrefix>
                  <Mail size={22} color="#888" />
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
                  <AtSign size={22} color="#888" />
                </ListGroup.ItemPrefix>
                <ListGroup.ItemContent>
                  <ListGroup.ItemTitle>Usuario</ListGroup.ItemTitle>
                  <ListGroup.ItemDescription>
                    {user.username ?? '—'}
                  </ListGroup.ItemDescription>
                </ListGroup.ItemContent>
              </ListGroup.Item>
              <Separator className="mx-4" />
              <ListGroup.Item>
                <ListGroup.ItemPrefix>
                  <Fingerprint size={22} color="#888" />
                </ListGroup.ItemPrefix>
                <ListGroup.ItemContent>
                  <ListGroup.ItemTitle>ID</ListGroup.ItemTitle>
                  <ListGroup.ItemDescription>{user.id}</ListGroup.ItemDescription>
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
