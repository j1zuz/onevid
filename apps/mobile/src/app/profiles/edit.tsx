import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { Button, Switch, Typography, useToast } from 'heroui-native';
import { ArrowLeft, Check, Trash2 } from 'lucide-react-native';
import { type ComponentProps, useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTvFocus, tvFocusRing } from '@/hooks/use-tv-focus';
import { AVATAR_KEYS, type AvatarKey, avatarSource } from '@/lib/avatars';
import {
  clearActiveProfile,
  confirmPinReset,
  createProfile,
  deleteProfile,
  listProfiles,
  requestPinReset,
  updateProfile,
} from '@/lib/profiles';
import { COLORS } from '@/lib/theme';

const PIN_INPUT_STYLE = {
  backgroundColor: 'rgba(255,255,255,0.08)',
  borderRadius: 12,
  paddingHorizontal: 16,
  paddingVertical: 14,
  color: '#fff',
  fontSize: 16,
  letterSpacing: 8,
} as const;

export default function EditProfileScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const editingId = params.id;
  const isEdit = Boolean(editingId);
  const { toast } = useToast();

  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState<AvatarKey>('black');
  const [isKids, setIsKids] = useState(false);

  const [hadPin, setHadPin] = useState(false); // este perfil ya tenía PIN
  const [lockEnabled, setLockEnabled] = useState(false); // proteger este perfil
  const [lockPin, setLockPin] = useState(''); // nuevo PIN para este perfil
  // El backend exige authPin cuando el PERFIL PRINCIPAL (primero creado) tiene
  // PIN — es el PIN de control parental que gobierna la gestión de perfiles.
  const [managePinRequired, setManagePinRequired] = useState(false);
  const [authPin, setAuthPin] = useState(''); // PIN del perfil principal

  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await listProfiles();
        if (cancelled) return;
        const primary = data.profiles[0]; // ordenado por createdAt
        setManagePinRequired(Boolean(primary?.hasPin));
        if (isEdit) {
          const p = data.profiles.find((x) => x.id === editingId);
          if (p) {
            setName(p.name);
            setAvatar(p.avatar);
            setIsKids(p.isKids);
            setHadPin(Boolean(p.hasPin));
            setLockEnabled(Boolean(p.hasPin));
          }
        }
      } catch {
        /* ignore — best effort */
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isEdit, editingId]);

  const [resetting, setResetting] = useState(false);
  const [resetMode, setResetMode] = useState(false);
  const [resetCode, setResetCode] = useState(''); // OTP de 6 dígitos del email

  const handleForgotPin = useCallback(async () => {
    setResetting(true);
    try {
      await requestPinReset();
      setResetMode(true);
      toast.show({
        variant: 'default',
        label: 'Código enviado',
        description: 'Revisa tu email e ingresa el código de 6 dígitos.',
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      toast.show({
        variant: 'danger',
        label: msg === 'no_pin' ? 'No hay PIN configurado' : 'No se pudo enviar',
      });
    } finally {
      setResetting(false);
    }
  }, [toast]);

  const handleConfirmReset = useCallback(async () => {
    if (resetCode.length < 6) return;
    try {
      const ok = await confirmPinReset(resetCode);
      if (ok) {
        setManagePinRequired(false);
        setResetMode(false);
        setResetCode('');
        setAuthPin('');
        toast.show({
          variant: 'success',
          label: 'PIN eliminado',
          description: 'Se quitó el PIN del perfil principal.',
        });
      } else {
        toast.show({ variant: 'danger', label: 'Código incorrecto o expirado' });
      }
    } catch {
      toast.show({ variant: 'danger', label: 'Código incorrecto o expirado' });
    }
  }, [resetCode, toast]);

  // Calcula el valor de lockPin a enviar (string=set, null=quitar, undefined=sin cambio)
  const resolveLockPin = useCallback((): string | null | undefined => {
    if (lockEnabled) {
      if (lockPin.length === 4) return lockPin;
      if (hadPin) return undefined; // mantener el PIN existente
      return null; // marcó proteger pero no escribió PIN → tratar como sin pin
    }
    return null; // quitar / sin bloqueo
  }, [lockEnabled, lockPin, hadPin]);

  const handleSave = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.show({ variant: 'warning', label: 'Ponle un nombre al perfil' });
      return;
    }
    if (lockEnabled && !hadPin && lockPin.length < 4) {
      toast.show({ variant: 'warning', label: 'El PIN debe tener 4 dígitos' });
      return;
    }
    if (managePinRequired && authPin.length < 4) {
      toast.show({
        variant: 'warning',
        label: 'Ingresa el PIN de control parental',
      });
      return;
    }
    setSaving(true);
    try {
      const lockPinArg = resolveLockPin();
      const authPinArg = managePinRequired ? authPin : undefined;
      if (isEdit && editingId) {
        await updateProfile(editingId, {
          name: trimmed,
          avatar,
          isKids,
          lockPin: lockPinArg,
          authPin: authPinArg,
        });
      } else {
        await createProfile({
          name: trimmed,
          avatar,
          isKids,
          lockPin: lockEnabled && lockPin.length === 4 ? lockPin : null,
          authPin: authPinArg,
        });
      }
      router.back();
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      toast.show({
        variant: 'danger',
        label:
          msg === 'max_profiles'
            ? 'Llegaste al máximo de perfiles'
            : msg === 'pin_invalid' || msg === 'pin_required'
              ? 'PIN de control parental incorrecto'
              : 'No se pudo guardar',
      });
    } finally {
      setSaving(false);
    }
  }, [
    name,
    avatar,
    isKids,
    lockEnabled,
    lockPin,
    hadPin,
    managePinRequired,
    authPin,
    isEdit,
    editingId,
    resolveLockPin,
    toast,
  ]);

  const handleDelete = useCallback(async () => {
    if (!editingId) return;
    if (managePinRequired && authPin.length < 4) {
      toast.show({
        variant: 'warning',
        label: 'Ingresa el PIN de control parental',
      });
      return;
    }
    setSaving(true);
    try {
      await deleteProfile(editingId, managePinRequired ? authPin : undefined);
      await clearActiveProfile();
      router.back();
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      toast.show({
        variant: 'danger',
        label:
          msg === 'pin_invalid' || msg === 'pin_required'
            ? 'PIN de control parental incorrecto'
            : 'No se pudo eliminar',
      });
    } finally {
      setSaving(false);
    }
  }, [editingId, managePinRequired, authPin, toast]);

  if (!loaded) {
    return <View style={{ flex: 1, backgroundColor: COLORS.background }} />;
  }

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: COLORS.background }}
      edges={['top', 'bottom']}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingHorizontal: 16,
          paddingVertical: 12,
        }}
      >
        <Pressable
          onPress={() => router.back()}
          style={(s) => [
            {
              width: 40,
              height: 40,
              borderRadius: 20,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'rgba(255,255,255,0.1)',
            },
            tvFocusRing((s as { focused?: boolean }).focused ?? false),
          ]}
        >
          <ArrowLeft size={22} color="#fff" />
        </Pressable>
        <Typography type="h4" weight="bold">
          {isEdit ? 'Editar perfil' : 'Nuevo perfil'}
        </Typography>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, gap: 28 }}>
        <View style={{ alignItems: 'center' }}>
          <Image
            source={avatarSource(avatar)}
            style={{ width: 120, height: 120, borderRadius: 24 }}
            contentFit="cover"
          />
        </View>

        <View style={{ gap: 8 }}>
          <Typography type="body-sm" color="muted">
            Nombre
          </Typography>
          <FocusTextInput
            value={name}
            onChangeText={setName}
            placeholder="Nombre del perfil"
            placeholderTextColor="#666"
            maxLength={20}
            style={{
              backgroundColor: 'rgba(255,255,255,0.08)',
              borderRadius: 12,
              paddingHorizontal: 16,
              paddingVertical: 14,
              color: '#fff',
              fontSize: 16,
            }}
          />
        </View>

        <View style={{ gap: 12 }}>
          <Typography type="body-sm" color="muted">
            Avatar
          </Typography>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
            {AVATAR_KEYS.map((key) => (
              <AvatarOption
                key={key}
                avatarKey={key}
                selected={avatar === key}
                onPress={() => setAvatar(key)}
              />
            ))}
          </View>
        </View>

        <ToggleRow
          title="Perfil infantil"
          subtitle="Sólo contenido apto para niños."
          value={isKids}
          onChange={setIsKids}
        />

        <View style={{ gap: 12 }}>
          <ToggleRow
            title="Proteger con PIN"
            subtitle="Pide un PIN al entrar a este perfil."
            value={lockEnabled}
            onChange={setLockEnabled}
          />
          {lockEnabled ? (
            <View style={{ gap: 6 }}>
              <Typography type="body-xs" color="muted">
                {hadPin
                  ? 'Nuevo PIN (deja vacío para mantener el actual)'
                  : 'PIN de 4 dígitos'}
              </Typography>
              <FocusTextInput
                value={lockPin}
                onChangeText={(t) =>
                  setLockPin(t.replace(/\D/g, '').slice(0, 4))
                }
                placeholder="••••"
                placeholderTextColor="#666"
                keyboardType="number-pad"
                secureTextEntry
                maxLength={4}
                style={PIN_INPUT_STYLE}
              />
            </View>
          ) : null}
        </View>

        {managePinRequired ? (
          <View style={{ gap: 8 }}>
            <Typography type="body-sm" color="muted">
              PIN de control parental
            </Typography>
            <Typography type="body-xs" color="muted">
              Ingresa el PIN del perfil principal para autorizar este cambio.
            </Typography>
            <FocusTextInput
              value={authPin}
              onChangeText={(t) => setAuthPin(t.replace(/\D/g, '').slice(0, 4))}
              placeholder="••••"
              placeholderTextColor="#666"
              keyboardType="number-pad"
              secureTextEntry
              maxLength={4}
              style={PIN_INPUT_STYLE}
            />
            <Pressable
              onPress={handleForgotPin}
              disabled={resetting}
              style={(s) => [
                { marginTop: 2, alignSelf: 'flex-start', borderRadius: 8 },
                tvFocusRing((s as { focused?: boolean }).focused ?? false),
              ]}
            >
              <Typography type="body-xs" style={{ color: '#3b82f6' }}>
                {resetting ? 'Enviando…' : 'Olvidé mi PIN'}
              </Typography>
            </Pressable>

            {resetMode ? (
              <View style={{ gap: 8, marginTop: 8 }}>
                <Typography type="body-xs" color="muted">
                  Código de 6 dígitos enviado a tu email:
                </Typography>
                <FocusTextInput
                  value={resetCode}
                  onChangeText={(t) =>
                    setResetCode(t.replace(/\D/g, '').slice(0, 6))
                  }
                  placeholder="••••••"
                  placeholderTextColor="#666"
                  keyboardType="number-pad"
                  maxLength={6}
                  style={PIN_INPUT_STYLE}
                />
                <FocusButton
                  variant="secondary"
                  onPress={handleConfirmReset}
                  isDisabled={resetCode.length < 6}
                >
                  Borrar PIN del perfil principal
                </FocusButton>
              </View>
            ) : null}
          </View>
        ) : null}

        <FocusButton onPress={handleSave} isDisabled={saving}>
          {saving ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Crear perfil'}
        </FocusButton>

        {isEdit ? (
          <FocusButton
            variant="secondary"
            onPress={handleDelete}
            isDisabled={saving}
            style={{ flexDirection: 'row', gap: 8 }}
          >
            <Trash2 size={18} color="#ef4444" />
            <Typography weight="semibold" style={{ color: '#ef4444' }}>
              Eliminar perfil
            </Typography>
          </FocusButton>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function ToggleRow({
  title,
  subtitle,
  value,
  onChange,
}: {
  title: string;
  subtitle: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  const { focused, focusProps } = useTvFocus();
  return (
    // Toda la fila es enfocable/pulsable: en TV se navega a la fila y OK
    // alterna; el Switch queda solo como indicador (pointerEvents none).
    <Pressable
      onPress={() => onChange(!value)}
      {...focusProps}
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderRadius: 12,
        },
        tvFocusRing(focused),
      ]}
    >
      <View style={{ flex: 1, paddingRight: 16 }}>
        <Typography type="body" weight="medium">
          {title}
        </Typography>
        <Typography type="body-xs" color="muted">
          {subtitle}
        </Typography>
      </View>
      <View pointerEvents="none">
        <Switch isSelected={value} onSelectedChange={onChange} />
      </View>
    </Pressable>
  );
}

function AvatarOption({
  avatarKey,
  selected,
  onPress,
}: {
  avatarKey: AvatarKey;
  selected: boolean;
  onPress: () => void;
}) {
  const { focused, focusProps } = useTvFocus();
  return (
    <Pressable onPress={onPress} {...focusProps}>
      <View
        style={{
          width: 72,
          height: 72,
          borderRadius: 16,
          overflow: 'hidden',
          borderWidth: selected || focused ? 3 : 0,
          borderColor: focused ? '#4f9dff' : '#fff',
        }}
      >
        <Image
          source={avatarSource(avatarKey)}
          style={{ width: '100%', height: '100%' }}
          contentFit="cover"
        />
        {selected ? (
          <View
            style={{
              position: 'absolute',
              right: 4,
              bottom: 4,
              backgroundColor: '#fff',
              borderRadius: 999,
              padding: 2,
            }}
          >
            <Check size={12} color="#000" />
          </View>
        ) : null}
      </View>
    </Pressable>
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

// TextInput con borde de foco para TV.
function FocusTextInput({ style, ...props }: ComponentProps<typeof TextInput>) {
  const { focused, focusProps } = useTvFocus();
  return (
    <TextInput
      {...props}
      onFocus={focusProps.onFocus}
      onBlur={focusProps.onBlur}
      style={[
        style,
        focused ? { borderWidth: 2, borderColor: '#4f9dff' } : null,
      ]}
    />
  );
}
