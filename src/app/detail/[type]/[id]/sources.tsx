import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { Typography } from 'heroui-native';
import { ArrowLeft } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SourcesList } from '@/components/sources-list';
import { useResponsive } from '@/hooks/use-responsive';
import { COLORS } from '@/lib/theme';

export default function SourcesPage() {
  const params = useLocalSearchParams<{
    type: string;
    id: string;
    season?: string;
    episode?: string;
    background?: string;
    logo?: string;
    title?: string;
  }>();
  const type = params.type === 'series' ? 'series' : 'movie';
  const id = params.id ?? '';
  const { isTV } = useResponsive();

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      {/* En TV: panel lateral sobre el backdrop difuminado (no pantalla
          completa). En la práctica TV abre las fuentes inline en el detalle,
          pero conservamos este layout por si se llega a la ruta. */}
      {isTV && params.background ? (
        <>
          <Image
            source={params.background}
            contentFit="cover"
            cachePolicy="memory-disk"
            blurRadius={12}
            style={[StyleSheet.absoluteFill, { opacity: 0.4 }]}
          />
          <View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: 'rgba(0,0,0,0.45)' },
            ]}
          />
        </>
      ) : null}

      <View style={isTV ? styles.tvPanel : { flex: 1 }}>
        <SafeAreaView edges={['top']} style={{ paddingHorizontal: 16 }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              paddingVertical: 12,
            }}
          >
            <Pressable
              onPress={() => router.back()}
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: 'rgba(255,255,255,0.1)',
                alignItems: 'center',
                justifyContent: 'center',
              }}
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
          season={params.season}
          episode={params.episode}
          onSelect={(s) =>
            router.push({
              pathname: '/player',
              params: {
                url: s.url,
                title: params.title || s.title,
                background: params.background ?? '',
                logo: params.logo ?? '',
              },
            })
          }
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tvPanel: {
    flex: 1,
    width: 600,
    maxWidth: '50%',
    alignSelf: 'flex-end',
    backgroundColor: COLORS.surface,
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(255,255,255,0.08)',
  },
});
