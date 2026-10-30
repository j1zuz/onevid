import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { PressableFeedback, Typography } from 'heroui-native';
import { Bookmark, Film, Trash2 } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EmptyState } from '@/components/empty-state';
import {
  type LocalVideo,
  localVideosQuery,
  removeLocalVideo,
} from '@/lib/local-videos';
import { COLORS } from '@/lib/theme';

/**
 * Biblioteca en modo local: los videos que el usuario agregó desde su
 * dispositivo o por URL. Se guardan en un JSON local (lib/local-videos.ts).
 */
export function LocalVideoLibrary() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const { data: videos = [] } = useQuery(localVideosQuery());

  // `url` acepta tanto URIs locales (file://, content://) como URLs remotas.
  const play = (video: LocalVideo) => {
    router.push({
      pathname: '/player',
      params: { url: video.uri, title: video.title },
    });
  };

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: COLORS.background,
        paddingTop: insets.top,
      }}
    >
      <ScrollView
        contentContainerStyle={{ paddingVertical: 16, gap: 20 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ paddingHorizontal: 16, gap: 4 }}>
          <Typography type="h2">{t('Biblioteca')}</Typography>
          <Typography type="body" color="muted">
            {t('Tus videos de este dispositivo')}
          </Typography>
        </View>

        {videos.length === 0 ? (
          <EmptyState
            icon={<Bookmark size={32} color="#9ca3af" />}
            title={t('Aún no tienes videos')}
            description={t(
              'Agrégalos desde Descubrir y aparecerán aquí para organizarlos.',
            )}
          />
        ) : (
          <View style={{ paddingHorizontal: 16, gap: 10 }}>
            {videos.map((video) => (
              <PressableFeedback
                key={video.id}
                onPress={() => play(video)}
                accessibilityRole="button"
                accessibilityLabel={video.title}
              >
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    padding: 12,
                    borderRadius: 16,
                    backgroundColor: '#141414',
                  }}
                >
                  <View
                    style={{
                      width: 42,
                      height: 42,
                      borderRadius: 12,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: 'rgba(255,255,255,0.06)',
                    }}
                  >
                    <Film size={20} color="#d4d4d8" />
                  </View>

                  <View style={{ flex: 1, gap: 2 }}>
                    <Typography type="body" weight="medium" numberOfLines={1}>
                      {video.title}
                    </Typography>
                    <Typography type="body-xs" color="muted">
                      {new Date(video.addedAt).toLocaleDateString()}
                    </Typography>
                  </View>

                  <Pressable
                    onPress={() => void removeLocalVideo(queryClient, video.id)}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel={t('Quitar de la biblioteca')}
                    style={({ pressed }) => ({
                      padding: 8,
                      borderRadius: 999,
                      opacity: pressed ? 0.6 : 1,
                    })}
                  >
                    <Trash2 size={18} color="#9ca3af" />
                  </Pressable>
                </View>
              </PressableFeedback>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
