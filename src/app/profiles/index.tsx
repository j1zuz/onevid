import { Image } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import {
  PressableFeedback,
  Skeleton,
  Typography,
  useToast,
} from 'heroui-native';
import { Lock, Pencil, Plus, XCircle } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { avatarSource } from '@/lib/avatars';
import {
  type Profile,
  listProfiles,
  setActiveProfile,
  verifyProfilePin,
} from '@/lib/profiles';
import { COLORS } from '@/lib/theme';

const AVATAR = 104;

export default function ProfilesScreen() {
  const { manage } = useLocalSearchParams<{ manage?: string }>();
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

  const enter = useCallback((p: Profile) => {
    // setActiveProfile fija el id en memoria de forma síncrona (apiFetch ya lo
    // usa) y persiste en SecureStore en segundo plano; navegamos de inmediato
    // para no mostrar la grilla un instante antes del home.
    void setActiveProfile(p);
    router.replace('/home');
  }, []);

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
              <View key={i} style={{ alignItems: 'center', gap: 10 }}>
                <Skeleton
                  style={{ width: AVATAR, height: AVATAR, borderRadius: 20 }}
                />
                <Skeleton style={{ width: 64, height: 12, borderRadius: 4 }} />
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
            {profiles.map((p) => (
              <PressableFeedback
                key={p.id}
                onPress={() => handlePick(p)}
                style={{ alignItems: 'center', gap: 10, width: AVATAR }}
              >
                <View
                  style={{
                    width: AVATAR,
                    height: AVATAR,
                    borderRadius: 20,
                    overflow: 'hidden',
                    opacity: editing ? 0.6 : 1,
                  }}
                >
                  <Image
                    source={avatarSource(p.avatar)}
                    style={{ width: '100%', height: '100%' }}
                    contentFit="cover"
                  />
                  {editing ? (
                    <View style={overlayStyle}>
                      <Pencil size={28} color="#fff" />
                    </View>
                  ) : null}
                </View>
                <View style={{ alignItems: 'center', gap: 3 }}>
                  <Typography type="body-sm" weight="medium" numberOfLines={1}>
                    {p.name}
                  </Typography>
                  {p.hasPin ? <Lock size={12} color="#888" /> : null}
                </View>
              </PressableFeedback>
            ))}

            {canAdd ? (
              <PressableFeedback
                onPress={() => router.push('/profiles/edit')}
                style={{ alignItems: 'center', gap: 10, width: AVATAR }}
              >
                <View
                  style={{
                    width: AVATAR,
                    height: AVATAR,
                    borderRadius: 20,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: 'rgba(255,255,255,0.08)',
                  }}
                >
                  <Plus size={40} color="#888" />
                </View>
                <Typography type="body-sm" color="muted">
                  Agregar
                </Typography>
              </PressableFeedback>
            ) : null}
          </View>
        )}

        {!loading && profiles.length > 0 ? (
          <Pressable onPress={() => setEditing((v) => !v)}>
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

        <View style={{ width: 240, height: 56 }}>
          {/* Input invisible que captura el teclado */}
          <TextInput
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
            style={{
              flexDirection: 'row',
              gap: 12,
              justifyContent: 'center',
            }}
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
        </View>
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
