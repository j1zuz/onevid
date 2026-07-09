import { Globe, Upload } from 'lucide-react-native';
import { Spinner, Typography, useToast } from 'heroui-native';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useState } from 'react';
import { Pressable, TextInput, useWindowDimensions, View } from 'react-native';
import { GodRaysBand } from '@/components/god-rays-band';
import { tvFocusRing, useTvFocus } from '@/hooks/use-tv-focus';
import { COLORS } from '@/lib/theme';

// Quita la extensión del nombre de archivo para usarlo como título legible.
function stripExt(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

/**
 * Panel "Reproducir video": elige un video de la galería y lo reproduce. Es la
 * funcionalidad disponible sin sesión; vive dentro del tab Inicio.
 */
export function LocalVideoPicker() {
  const { height: windowHeight } = useWindowDimensions();
  const { toast } = useToast();
  const [picking, setPicking] = useState(false);
  const [urlInput, setUrlInput] = useState('');

  // Reproduce una URL remota (video directo o stream en vivo HLS .m3u8), igual
  // que el modo local de la web. libVLC abre HLS y MP4 de forma nativa; al no
  // pasar `id`, el reproductor no arma fallback ni pide fuentes: reproduce esa
  // URL directamente (ver player.tsx).
  const handleLoadUrl = useCallback(() => {
    const url = urlInput.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) {
      toast.show({
        variant: 'danger',
        label: 'URL no válida',
        description: 'Introduce una URL http(s) válida.',
      });
      return;
    }
    // Título legible a partir del último segmento del path (como la web).
    let title = 'Video';
    try {
      const last = new URL(url).pathname.split('/').pop();
      if (last) title = stripExt(decodeURIComponent(last));
    } catch {
      /* URL sin path usable: dejamos "Video" */
    }
    router.push({ pathname: '/player', params: { url, title } });
  }, [urlInput, toast]);

  const handlePick = useCallback(async () => {
    if (picking) return;
    setPicking(true);
    try {
      // En videos conviene pedir el permiso antes de abrir el selector para que
      // el diálogo del sistema no aparezca después de elegir (recomendación de
      // expo-image-picker).
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        toast.show({
          variant: 'danger',
          label: 'Permiso necesario',
          description: 'Da acceso a tu galería para elegir un video.',
        });
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['videos'],
        quality: 1,
      });
      if (res.canceled) return;
      const asset = res.assets[0];
      if (!asset?.uri) {
        toast.show({ variant: 'danger', label: 'No se pudo abrir el video' });
        return;
      }
      router.push({
        pathname: '/player',
        params: { url: asset.uri, title: stripExt(asset.fileName ?? 'Video') },
      });
    } catch (e) {
      toast.show({
        variant: 'danger',
        label: 'No se pudo seleccionar el video',
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setPicking(false);
    }
  }, [picking, toast]);

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <GodRaysBand height={Math.round(windowHeight * 0.28)} />
      <View style={{ flex: 1 }} className="items-center justify-center px-6">
        <View className="w-full gap-8">
          <View className="items-center gap-2">
            <Typography type="h2" align="center" color="default">
              Reproducir video
            </Typography>
            <Typography type="body" color="muted" align="center">
              Elige un video de tu dispositivo o pega una URL
            </Typography>
          </View>

          <Pressable
            accessibilityRole="button"
            disabled={picking}
            onPress={handlePick}
            style={(s) => [
              {
                width: '100%',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 16,
                paddingVertical: 48,
                paddingHorizontal: 24,
                borderRadius: 24,
                borderWidth: 2,
                borderStyle: 'dashed',
                borderColor: '#3f3f46',
                backgroundColor: COLORS.surface,
                opacity: picking ? 0.6 : 1,
              },
              tvFocusRing((s as { focused?: boolean }).focused ?? false),
            ]}
          >
            {picking ? (
              <Spinner />
            ) : (
              <View
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 999,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: '#27272a',
                }}
              >
                <Upload size={28} color="#e5e7eb" />
              </View>
            )}
            <View style={{ alignItems: 'center', gap: 4 }}>
              <Typography type="h5" align="center" color="default">
                Sube un video para reproducir
              </Typography>
              <Typography type="body-sm" color="muted" align="center">
                Toca para seleccionar desde tu galería
              </Typography>
            </View>
          </Pressable>

          {/* Separador "o" entre subir archivo y pegar URL. */}
          <View className="flex-row items-center gap-3">
            <View style={{ flex: 1, height: 1, backgroundColor: '#27272a' }} />
            <Typography type="body-sm" color="muted">
              o
            </Typography>
            <View style={{ flex: 1, height: 1, backgroundColor: '#27272a' }} />
          </View>

          {/* URL de video o stream en vivo (HLS): globo + input + botón unidos en
              un solo contenedor con borde, igual que la web. */}
          <UrlBar
            value={urlInput}
            onChangeText={setUrlInput}
            onSubmit={handleLoadUrl}
          />
        </View>
      </View>
    </View>
  );
}

// Barra de URL unificada (globo + input + botón "Reproducir" en un mismo
// contenedor con borde), como la web. El input no lleva borde propio: el borde
// vive en el contenedor y se ilumina al enfocar (útil en TV).
function UrlBar({
  value,
  onChangeText,
  onSubmit,
}: {
  value: string;
  onChangeText: (v: string) => void;
  onSubmit: () => void;
}) {
  const { focused, focusProps } = useTvFocus();
  const disabled = !value.trim();
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          width: '100%',
          borderRadius: 12,
          borderWidth: 1,
          borderColor: focused ? '#4f9dff' : '#3f3f46',
          backgroundColor: COLORS.surface,
          paddingLeft: 12,
          paddingRight: 4,
          overflow: 'hidden',
        },
        tvFocusRing(focused),
      ]}
    >
      <Globe size={18} color="#666" />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmit}
        onFocus={focusProps.onFocus}
        onBlur={focusProps.onBlur}
        placeholder="URL de video o stream en vivo…"
        placeholderTextColor="#666"
        keyboardType="url"
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="go"
        style={{
          flex: 1,
          color: '#fff',
          paddingHorizontal: 10,
          paddingVertical: 12,
          fontSize: 15,
        }}
      />
      <Pressable
        accessibilityRole="button"
        disabled={disabled}
        onPress={onSubmit}
        style={{
          paddingHorizontal: 16,
          paddingVertical: 8,
          borderRadius: 9,
          backgroundColor: '#fff',
          opacity: disabled ? 0.4 : 1,
        }}
      >
        <Typography type="body-sm" weight="semibold" style={{ color: '#000' }}>
          Reproducir
        </Typography>
      </Pressable>
    </View>
  );
}
