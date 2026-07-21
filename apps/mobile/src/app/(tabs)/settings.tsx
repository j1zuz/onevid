import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { LogIn } from 'lucide-react-native';
import { GlassIcon } from '@/components/glass-icon';
import { LanguageSheet } from '@/components/language-sheet';
import { SUPPORTED_LANGUAGES } from '@/lib/i18n/languages';
import {
  Button,
  Card,
  ListGroup,
  Separator,
  Skeleton,
  Typography,
} from 'heroui-native';
import { type ComponentProps, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StreamLoginSheet } from '@/components/stream-login-sheet';
import { useAppSurface } from '@/hooks/use-app-surface';
import { type AppMode, setAppMode } from '@/lib/app-mode';
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
  const { t, i18n } = useTranslation();
  // Sheet de selección de idioma (se abre desde la lista de Perfil).
  const [langOpen, setLangOpen] = useState(false);
  // Etiqueta legible del idioma activo para mostrar en la lista.
  const currentLanguageLabel =
    SUPPORTED_LANGUAGES.find((l) => l.code === i18n.language)?.label ??
    i18n.language;
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  // true una vez que `loadActiveProfile()` resolvió al menos una vez (perfil
  // puede ser legítimamente null, así que no basta con chequear `profile`).
  const [profileLoaded, setProfileLoaded] = useState(false);
  // Sesión + modo (local/stream), revalidados en cada focus. Mientras carga es
  // null; sin sesión mostramos el CTA de iniciar sesión; con sesión, la cuenta.
  const surface = useAppSurface();
  const authed = surface ? surface.authed : null;
  const mode = surface?.mode;
  // Drawer de login por QR (modo Stream).
  const [loginOpen, setLoginOpen] = useState(false);

  // El perfil activo se carga aparte (es local, de SecureStore).
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      loadActiveProfile()
        .then((p) => {
          if (!cancelled) setProfile(p);
        })
        .catch(() => undefined)
        .finally(() => {
          if (!cancelled) setProfileLoaded(true);
        });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const handleSwitchProfile = useCallback(async () => {
    await clearActiveProfile();
    router.replace('/profiles');
  }, []);

  // Cambia entre modo stream (catálogo) y local (Reproducir video) SIN cerrar
  // sesión. Al volver a Inicio se ve el modo elegido.
  const handleSwitchMode = useCallback(async (next: AppMode) => {
    await setAppMode(next);
    router.replace('/home');
  }, []);

  // Solo pedimos la sesión al backend cuando hay token; sin él no hay nada que
  // pedir (evita un 401 y un mensaje de error espurio en modo local). Todo lo que
  // depende de `loading` está gateado por `authed === true`, así que no hace falta
  // tocar `loading` cuando no hay sesión.
  useEffect(() => {
    if (authed !== true) return;
    let cancelled = false;
    apiFetch<SessionResponse | null>('/api/auth/get-session')
      .then((data) => {
        if (!cancelled) setUser(data?.user ?? null);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : t('Error de sesión'));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authed, t]);

  const handleLogout = async () => {
    await clearActiveProfile();
    await clearAccessToken();
    router.replace('/home');
  };

  const handleLogin = useCallback(() => {
    setLoginOpen(true);
  }, []);

  // `surface`, `profile` y la sesión resuelven en ticks distintos vía
  // SecureStore/fetch aunque no haya red lenta; sin este gate combinado cada
  // bloque de abajo aparece por separado apenas resuelve, dando el efecto de
  // "cascada" (texto primero, resto cayendo). Con `ready`, todo el contenido
  // variable se pinta de una sola vez.
  const sessionReady = authed !== true || !loading;
  const ready = surface !== null && profileLoaded && sessionReady;
  // `insets.top` viene de `initialWindowMetrics` (sembrado sincrónicamente por
  // SafeAreaProvider en _layout.tsx): a diferencia de `<SafeAreaView>` (nativo,
  // mide en un frame posterior al primer render), esto evita el salto donde el
  // contenido aparece pegado arriba y luego "baja" a su padding correcto.
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: COLORS.background,
        paddingTop: insets.top,
      }}
    >
      <ScrollView contentContainerClassName="gap-6 px-4 py-6">
        <View className="gap-1">
          <Typography type="h2">{t('Configuración')}</Typography>
          <Typography type="body" color="muted">
            {t('Tu cuenta y preferencias')}
          </Typography>
        </View>

        {ready ? (
          <>
            {authed === false ? (
              <Card>
                <Card.Body className="gap-3">
                  <View className="flex-row items-center gap-3">
                    <View
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 12,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: '#27272a',
                      }}
                    >
                      <LogIn size={24} color="#e5e7eb" />
                    </View>
                    <View className="flex-1">
                      <Typography type="h5">{t('Modo Stream')}</Typography>
                      <Typography type="body-sm" color="muted">
                        {t('Inicia sesión para el modo stream.')}
                      </Typography>
                    </View>
                  </View>
                  <FocusButton onPress={handleLogin}>
                    {t('Iniciar sesión')}
                  </FocusButton>
                </Card.Body>
              </Card>
            ) : null}

            {authed === true && error ? (
              <Card>
                <Card.Body>
                  <Typography type="body-sm" color="muted">
                    {error}
                  </Typography>
                </Card.Body>
              </Card>
            ) : null}

            {/* Con sesión mostramos SIEMPRE la Card de perfil, tenga o no un
                perfil activo. Sin este caso `!profile`, un usuario autenticado
                sin perfil elegido (p. ej. cerró la app durante /profiles, o se
                perdió el perfil guardado) quedaba sin ninguna entrada a /profiles
                fuera del arranque (_layout solo enruta ahí con hasToken&&!profile
                al boot) → no podía elegir/cambiar de perfil, sobre todo en móvil. */}
            {authed === true ? (
              <Card>
                <Card.Body className="flex-row items-center gap-4">
                  <Image
                    source={avatarSource(profile?.avatar)}
                    style={{ width: 56, height: 56, borderRadius: 14 }}
                    contentFit="cover"
                  />
                  <View className="flex-1 gap-0.5">
                    <Typography type="body-xs" color="muted">
                      {t('Perfil')}
                    </Typography>
                    <Typography type="h5">
                      {profile ? profile.name : t('Sin perfil')}
                    </Typography>
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
                      {profile ? t('Cambiar') : t('Elegir perfil')}
                    </Typography>
                  </Pressable>
                </Card.Body>
              </Card>
            ) : null}

            {user ? (
              <ListGroup>
                <ListGroup.Item>
                  <ListGroup.ItemPrefix>
                    <GlassIcon name="inbox" size={24} />
                  </ListGroup.ItemPrefix>
                  <ListGroup.ItemContent>
                    <ListGroup.ItemTitle>{t('Email')}</ListGroup.ItemTitle>
                    <ListGroup.ItemDescription>
                      {user.email}
                    </ListGroup.ItemDescription>
                  </ListGroup.ItemContent>
                </ListGroup.Item>
                <Separator className="mx-4" />
                <LanguageRow
                  label={currentLanguageLabel}
                  onPress={() => setLangOpen(true)}
                />
              </ListGroup>
            ) : null}

            {authed === true && !Platform.isTV ? (
              <FocusButton
                onPress={() =>
                  handleSwitchMode(mode === 'local' ? 'stream' : 'local')
                }
                variant="secondary"
              >
                {mode === 'local'
                  ? t('Cambiar a modo Stream')
                  : t('Cambiar a modo Local')}
              </FocusButton>
            ) : null}

            {authed === true ? (
              <FocusButton onPress={handleLogout} variant="secondary">
                {t('Cerrar sesión')}
              </FocusButton>
            ) : null}
          </>
        ) : (
          <>
            {/* Skeleton genérico de página completa: se pinta mientras
                surface/perfil/sesión resuelven, para que el contenido real
                aparezca todo de una vez en vez de bloque a bloque. */}
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
        )}
      </ScrollView>

      <StreamLoginSheet
        visible={loginOpen}
        onClose={() => setLoginOpen(false)}
      />
      <LanguageSheet visible={langOpen} onClose={() => setLangOpen(false)} />
    </View>
  );
}

// Fila de idioma para la lista de Perfil: abre el sheet de selección. Muestra el
// idioma activo como descripción y una flecha (chevron) por defecto a la derecha.
function LanguageRow({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const { focused, focusProps } = useTvFocus();
  return (
    <ListGroup.Item onPress={onPress} {...focusProps} style={tvFocusRing(focused)}>
      <ListGroup.ItemPrefix>
        <GlassIcon name="badge-sparkle" size={24} />
      </ListGroup.ItemPrefix>
      <ListGroup.ItemContent>
        <ListGroup.ItemTitle>{t('Idioma')}</ListGroup.ItemTitle>
        <ListGroup.ItemDescription>{label}</ListGroup.ItemDescription>
      </ListGroup.ItemContent>
      <ListGroup.ItemSuffix />
    </ListGroup.Item>
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
