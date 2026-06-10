import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Typography } from 'heroui-native';
import { ArrowLeft } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SourcesList } from '@/components/sources-list';
import { useResponsive } from '@/hooks/use-responsive';
import { useTvFocus, tvFocusRing } from '@/hooks/use-tv-focus';
import { COLORS } from '@/lib/theme';

/**
 * Panel de fuentes como overlay sobre el detalle. Reemplaza la antigua pantalla
 * /sources: ahora NO se navega a otra página ni en móvil ni en TV.
 *
 * - Móvil: panel anclado abajo (tipo hoja) sobre el detalle atenuado, dejando
 *   ver el contenido detrás — igual que en TV, no a pantalla completa.
 * - TV: panel lateral derecho sobre el backdrop difuminado.
 */
export function SourcesOverlay({
  type,
  id,
  season,
  episode,
  title,
  background,
  logo,
  onClose,
}: {
  type: 'movie' | 'series';
  id: string;
  season?: string;
  episode?: string;
  title?: string;
  background?: string;
  logo?: string;
  onClose: () => void;
}) {
  const { isTV } = useResponsive();
  const closeFocus = useTvFocus();

  return (
    <View style={StyleSheet.absoluteFill}>
      {isTV && background ? (
        <Image
          source={background}
          contentFit="cover"
          cachePolicy="memory-disk"
          blurRadius={12}
          style={[StyleSheet.absoluteFill, { opacity: 0.4 }]}
        />
      ) : null}

      {/* Fondo atenuado: cierra al tocar (no enfocable para no robar el D-pad). */}
      <Pressable
        focusable={false}
        style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.55)' }]}
        onPress={onClose}
      />

      <View style={isTV ? styles.tvPanel : styles.mobilePanel}>
        <SafeAreaView
          edges={isTV ? ['top'] : []}
          style={{ paddingHorizontal: 16 }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              paddingVertical: 12,
            }}
          >
            <Pressable
              onPress={onClose}
              {...closeFocus.focusProps}
              style={[styles.backBtn, tvFocusRing(closeFocus.focused)]}
            >
              <ArrowLeft size={22} color="#fff" />
            </Pressable>
            <Typography type="h4" weight="bold">
              Fuentes
            </Typography>
          </View>
        </SafeAreaView>

        <SourcesList
          type={type}
          id={id}
          season={season}
          episode={episode}
          onSelect={(s) => {
            onClose();
            router.push({
              pathname: '/player',
              params: {
                url: s.url,
                title: title || s.title,
                background: background ?? '',
                logo: logo ?? '',
                // Para poder cambiar de fuente desde el reproductor.
                type,
                id,
                ...(season ? { season } : {}),
                ...(episode ? { episode } : {}),
              },
            });
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // TV: panel lateral derecho sobre el backdrop.
  tvPanel: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    width: 600,
    maxWidth: '50%',
    backgroundColor: COLORS.surface,
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(255,255,255,0.08)',
  },
  // Móvil: panel anclado abajo (tipo hoja) sobre el detalle atenuado. Usa
  // top+bottom para tener altura definida (como tvPanel), así la lista interna
  // hace scroll correctamente. El 18% superior deja ver el detalle detrás.
  mobilePanel: {
    position: 'absolute',
    top: '18%',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
