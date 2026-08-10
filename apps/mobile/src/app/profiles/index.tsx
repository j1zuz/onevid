import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import {
  PressableFeedback,
  Skeleton,
  Typography,
  useToast,
} from 'heroui-native';
import { Lock, Pencil, Plus, XCircle } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BackHandler, Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTvFocus, tvFocusRing } from '@/hooks/use-tv-focus';
import { avatarSource } from '@/lib/avatars';
import { prefetchFeed, prefetchHome } from '@/lib/home-feed';
import {
  type Profile,
  listProfiles,
  loadActiveProfile,
  setActiveProfile,
  verifyProfilePin,
} from '@/lib/profiles';
import { COLORS } from '@/lib/theme';

const AVATAR = 104;
// Alto fijo del área del nombre: nombre (body-sm, lineHeight 24) + gap 3 +
// candado 12. Reservarlo en TODAS las tarjetas (con o sin PIN) y en el skeleton
// hace que la grilla sea uniforme y no salte al cargar.
const NAME_AREA_H = 39;

export default function ProfilesScreen() {
  const { manage } = useLocalSearchParams<{ manage?: string }>();
  const queryClient = useQueryClient();
  const { i18n } = useTranslation();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [max, setMax] = useState(5);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(manage === '1');
  const [pinFor, setPinFor] = useState<Profile | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listProfiles();
      setProfiles(data.profiles ?? []);
      setMax(data.max ?? 5);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cargar.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Netflix-style: mientras el usuario elige perfil, precalentamos el catálogo
  // del Inicio (JSON del feed + primeras carátulas) en segundo plano y sin
  // spinner, para que al entrar el Inicio ya tenga contenido en cache. Primero
  // rehidratamos el último perfil usado (loadActiveProfile fija el header
  // X-Profile-Id) por si el feed va scopeado; NO precargamos "Continuar viendo"
  // aquí para no traer datos de un perfil que quizá no sea el que se elija.
  useEffect(() => {
    let cancelled = false;
    loadActiveProfile()
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) void prefetchFeed(queryClient, i18n.language);
      });
    return () => {
      cancelled = true;
    };
  }, [queryClient, i18n.language]);

  const enter = useCallback(
    (p: Profile) => {
      // setActiveProfile fija el id en memoria de forma síncrona (apiFetch ya lo
      // usa) y persiste en SecureStore en segundo plano; navegamos de inmediato
      // para no mostrar la grilla un instante antes del home.
      void setActiveProfile(p);
      // Con el perfil ya activo (header X-Profile-Id correcto) precalentamos el
      // feed del Inicio en segundo plano, para que al montar Inicio las
      // carátulas ya estén y no se vea el fallback gris.
      void prefetchHome(queryClient, i18n.language);
      router.replace('/home');
    },
    [queryClient, i18n.language],
  );

  const handlePick = useCallback(
    (p: Profile) => {
      if (editing) {
        router.push({ pathname: '/profiles/edit', params: { id: p.id } });
        return;
      }
      if (p.hasPin) {
        setPinFor(p);
        return;
      }
      enter(p);
    },
    [editing, enter],
  );

  const canAdd = profiles.length < max;

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: COLORS.background }}
      edges={['top', 'bottom']}
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          gap: 32,
        }}
      >
        <Typography type="h2" weight="bold" align="center">
          ¿Quién está viendo?
        </Typography>

        {loading ? (
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              justifyContent: 'center',
              gap: 24,
              maxWidth: 460,
            }}
          >
            {[0, 1, 2].map((i) => (
              // Misma estructura/altura que el item real (avatar + gap 10 +
              // nombre body-sm) para que la grilla no salte al cargar.
              <View key={i} style={{ alignItems: 'center', gap: 10, width: AVATAR }}>
                <Skeleton
                  style={{ width: AVATAR, height: AVATAR, borderRadius: 20 }}
                />
                {/* Mismo alto reservado que las tarjetas reales (nombre +
                    candado) para que la grilla no cambie de altura al cargar. */}
                <View style={{ height: NAME_AREA_H, alignItems: 'center', paddingTop: 5 }}>
                  <Skeleton style={{ width: 64, height: 14, borderRadius: 4 }} />
                </View>
              </View>
            ))}
          </View>
        ) : error ? (
          <Typography type="body" color="muted" align="center">
            {error}
          </Typography>
        ) : (
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              justifyContent: 'center',
              gap: 24,
              maxWidth: 460,
            }}
          >
            {profiles.map((p, i) => (
              <ProfileCard
                key={p.id}
                profile={p}
                editing={editing}
                autoFocus={i === 0}
                onPress={() => handlePick(p)}
              />
            ))}

            {canAdd ? (
              <AddCard onPress={() => router.push('/profiles/edit')} />
            ) : null}
          </View>
        )}

        {!loading && profiles.length > 0 ? (
          <Pressable
            onPress={() => setEditing((v) => !v)}
            style={(s) => [
              { paddingVertical: 8, paddingHorizontal: 18, borderRadius: 999 },
              tvFocusRing((s as { focused?: boolean }).focused ?? false),
            ]}
          >
            <Typography type="body-sm" color="muted" weight="medium">
              {editing ? 'Listo' : 'Administrar perfiles'}
            </Typography>
          </Pressable>
        ) : null}
      </ScrollView>

      {pinFor ? (
        <PinPrompt
          profile={pinFor}
          onCancel={() => setPinFor(null)}
          onSuccess={() => {
            // Navegar directo; la pantalla se desmonta con el replace, así no
            // se ve la grilla de perfiles entre medio.
            if (pinFor) enter(pinFor);
          }}
        />
      ) : null}
    </SafeAreaView>
  );
}

function ProfileCard({
  profile,
  editing,
  autoFocus = false,
  onPress,
}: {
  profile: Profile;
  editing: boolean;
  autoFocus?: boolean;
  onPress: () => void;
}) {
  const { focused, focusProps } = useTvFocus();
  return (
    <PressableFeedback
      onPress={onPress}
      {...focusProps}
      // Foco inicial en TV: el primer perfil queda enfocado al abrir la pantalla.
      hasTVPreferredFocus={autoFocus}
      style={{ alignItems: 'center', gap: 10, width: AVATAR }}
    >
      <View
        style={[
          {
            width: AVATAR,
            height: AVATAR,
            borderRadius: 20,
            overflow: 'hidden',
            opacity: editing ? 0.6 : 1,
          },
          tvFocusRing(focused),
        ]}
      >
        <Image
          source={avatarSource(profile.avatar)}
          style={{ width: '100%', height: '100%' }}
          contentFit="cover"
        />
        {editing ? (
          <View style={overlayStyle}>
            <Pencil size={28} color="#fff" />
          </View>
        ) : null}
      </View>
      <View style={{ alignItems: 'center', gap: 3, height: NAME_AREA_H }}>
        <Typography type="body-sm" weight="medium" numberOfLines={1}>
          {profile.name}
        </Typography>
        {profile.hasPin ? <Lock size={12} color="#888" /> : null}
      </View>
    </PressableFeedback>
  );
}

function AddCard({ onPress }: { onPress: () => void }) {
  const { focused, focusProps } = useTvFocus();
  return (
    <PressableFeedback
      onPress={onPress}
      {...focusProps}
      style={{ alignItems: 'center', gap: 10, width: AVATAR }}
    >
      <View
        style={[
          {
            width: AVATAR,
            height: AVATAR,
            borderRadius: 20,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(255,255,255,0.08)',
          },
          tvFocusRing(focused),
        ]}
      >
        <Plus size={40} color="#888" />
      </View>
      <View style={{ height: NAME_AREA_H, alignItems: 'center' }}>
        <Typography type="body-sm" color="muted">
          Agregar
        </Typography>
      </View>
    </PressableFeedback>
  );
}

function PinPrompt({
  profile,
  onCancel,
  onSuccess,
}: {
  profile: Profile;
  onCancel: () => void;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const [pin, setPin] = useState('');
  const [checking, setChecking] = useState(false);
  const inputRef = useRef<TextInput>(null);

  // Tras un PIN incorrecto el input se vacía; lo re-enfocamos al terminar la
  // validación con el campo vacío para poder reintentar sin tocar de nuevo.
  useEffect(() => {
    if (!checking && pin.length === 0) {
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [checking, pin.length]);

  const submit = useCallback(
    async (value: string) => {
      setChecking(true);
      try {
        const ok = await verifyProfilePin(profile.id, value);
        if (ok) {
          onSuccess();
        } else {
          setPin('');
          toast.show({
          variant: 'danger',
          label: 'PIN incorrecto',
          icon: <XCircle size={20} color="#ef4444" />,
        });
        }
      } catch {
        setPin('');
        toast.show({
          variant: 'danger',
          label: 'PIN incorrecto',
          icon: <XCircle size={20} color="#ef4444" />,
        });
      } finally {
        setChecking(false);
      }
    },
    [profile.id, onSuccess, toast],
  );

  const onChange = useCallback(
    (t: string) => {
      const digits = t.replace(/\D/g, '').slice(0, 4);
      setPin(digits);
      if (digits.length === 4) submit(digits); // auto-validar
    },
    [submit],
  );

  // En TV el botón Atrás del control debe cerrar el PIN y volver a la grilla de
  // perfiles (no salir de la app ni quedarse atascado).
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onCancel();
      return true;
    });
    return () => sub.remove();
  }, [onCancel]);

  return (
    <Pressable
      onPress={onCancel}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: '#000',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
        <Pressable
          onPress={() => undefined}
          style={{ alignItems: 'center', gap: 20 }}
        >
        <View style={{ alignItems: 'center', gap: 6 }}>
          <Typography type="h4" weight="bold" align="center">
            {profile.name}
          </Typography>
          <Typography type="body-sm" color="muted" align="center">
            Ingresa el PIN de este perfil
          </Typography>
        </View>

        {/* Tocar/seleccionar las cajas re-enfoca el input → reabre el teclado
            del sistema (antes, una vez cerrado, ya no volvía a abrirse). */}
        <Pressable
          onPress={() => inputRef.current?.focus()}
          style={{ width: 240, height: 56 }}
        >
          {/* Input invisible que captura el teclado */}
          <TextInput
            ref={inputRef}
            value={pin}
            onChangeText={onChange}
            keyboardType="number-pad"
            autoFocus
            maxLength={4}
            editable={!checking}
            caretHidden
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              opacity: 0,
            }}
          />
          {/* Cajas visuales */}
          <View
            pointerEvents="none"
            style={{ flexDirection: 'row', gap: 12, justifyContent: 'center' }}
          >
            {[0, 1, 2, 3].map((i) => (
              <View
                key={i}
                style={{
                  width: 48,
                  height: 56,
                  borderRadius: 12,
                  backgroundColor: 'rgba(255,255,255,0.1)',
                  borderWidth: pin.length === i ? 2 : 0,
                  borderColor: '#3b82f6',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {pin.length > i ? (
                  <View
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: 6,
                      backgroundColor: '#fff',
                    }}
                  />
                ) : null}
              </View>
            ))}
          </View>
        </Pressable>

        {/* Volver a elegir perfil. En TV es enfocable con el D-pad; en móvil
            también sirve además de tocar fuera. */}
        <Pressable
          onPress={onCancel}
          style={(s) => [
            { paddingVertical: 10, paddingHorizontal: 24, borderRadius: 999 },
            tvFocusRing((s as { focused?: boolean }).focused ?? false),
          ]}
        >
          <Typography type="body-sm" color="muted" weight="medium">
            Cancelar
          </Typography>
        </Pressable>
        </Pressable>
    </Pressable>
  );
}

const overlayStyle = {
  position: 'absolute' as const,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
  backgroundColor: 'rgba(0,0,0,0.4)',
};
