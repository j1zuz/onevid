import { useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { Button, Spinner, Typography, useToast } from 'heroui-native';
import { Globe, Upload } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { addLocalVideo, titleFromFileName } from '@/lib/local-videos';
import { COLORS } from '@/lib/theme';

/**
 * Descubrir en modo local: en vez de buscar en el catálogo (que requiere
 * cuenta), permite agregar videos propios del dispositivo o por URL a la
 * biblioteca local.
 */
export function LocalVideoImport() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const [picking, setPicking] = useState(false);
  const [urlInput, setUrlInput] = useState('');

  const handlePick = useCallback(async () => {
    if (picking) return;
    setPicking(true);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        toast.show({
          variant: 'danger',
          label: t('Permiso necesario'),
          description: t('Da acceso a tu galería para elegir un video.'),
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
        toast.show({
          variant: 'danger',
          label: t('No se pudo abrir el video'),
        });
        return;
      }
      const title = titleFromFileName(asset.fileName);
      await addLocalVideo(queryClient, { uri: asset.uri, title });
      toast.show({
        variant: 'success',
        label: t('Agregado a tu biblioteca'),
        description: title,
      });
    } catch (e) {
      toast.show({
        variant: 'danger',
        label: t('No se pudo seleccionar el video'),
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setPicking(false);
    }
  }, [picking, queryClient, t, toast]);

  const handleAddUrl = useCallback(async () => {
    const url = urlInput.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) {
      toast.show({
        variant: 'danger',
        label: t('URL no válida'),
        description: t('Introduce una URL http(s) válida.'),
      });
      return;
    }
    let title = 'Video';
    try {
      const last = new URL(url).pathname.split('/').pop();
      if (last) title = titleFromFileName(decodeURIComponent(last));
    } catch {
      /* URL sin path usable */
    }
    await addLocalVideo(queryClient, { uri: url, title });
    setUrlInput('');
    toast.show({
      variant: 'success',
      label: t('Agregado a tu biblioteca'),
      description: title,
    });
  }, [queryClient, t, toast, urlInput]);

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: COLORS.background,
        paddingTop: insets.top,
      }}
    >
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 20 }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ gap: 4 }}>
          <Typography type="h2">{t('Descubrir')}</Typography>
          <Typography type="body" color="muted">
            {t('Agrega videos de tu dispositivo a tu biblioteca')}
          </Typography>
        </View>

        <Pressable
          accessibilityRole="button"
          disabled={picking}
          onPress={handlePick}
          style={({ pressed }) => ({
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            paddingVertical: 36,
            paddingHorizontal: 20,
            borderRadius: 20,
            borderWidth: 1,
            borderStyle: 'dashed',
            borderColor: 'rgba(255,255,255,0.18)',
            backgroundColor: pressed ? 'rgba(255,255,255,0.04)' : 'transparent',
          })}
        >
          <View
            style={{
              width: 56,
              height: 56,
              borderRadius: 28,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'rgba(255,255,255,0.08)',
            }}
          >
            {picking ? (
              <Spinner size="sm" color="#fff" />
            ) : (
              <Upload size={24} color="#e5e7eb" />
            )}
          </View>
          <View style={{ alignItems: 'center', gap: 4 }}>
            <Typography type="h5" align="center">
              {t('Agregar video')}
            </Typography>
            <Typography type="body-sm" color="muted" align="center">
              {t('Toca para elegir desde tu galería')}
            </Typography>
          </View>
        </Pressable>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View
            style={{
              flex: 1,
              height: 1,
              backgroundColor: 'rgba(255,255,255,0.1)',
            }}
          />
          <Typography type="body-xs" color="muted">
            {t('o')}
          </Typography>
          <View
            style={{
              flex: 1,
              height: 1,
              backgroundColor: 'rgba(255,255,255,0.1)',
            }}
          />
        </View>

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            paddingLeft: 14,
            paddingRight: 6,
            height: 52,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.12)',
            backgroundColor: 'rgba(255,255,255,0.03)',
          }}
        >
          <Globe size={18} color="#9ca3af" />
          <TextInput
            value={urlInput}
            onChangeText={setUrlInput}
            placeholder={t('URL de video o stream')}
            placeholderTextColor="#6b7280"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            onSubmitEditing={() => void handleAddUrl()}
            style={{ flex: 1, color: '#fff', fontSize: 15 }}
          />
          <Button
            variant="secondary"
            size="sm"
            isDisabled={urlInput.trim().length === 0}
            onPress={() => void handleAddUrl()}
          >
            {t('Agregar')}
          </Button>
        </View>
      </ScrollView>
    </View>
  );
}
