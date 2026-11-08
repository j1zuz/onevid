import { Typography } from 'heroui-native';
import { Check, X } from 'lucide-react-native';
import { type ComponentRef, type Ref, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FlatList,
  Image,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TvSheet } from '@/components/tv-sheet';
import { tvFocusRing, useTvFocus } from '@/hooks/use-tv-focus';
import {
  AVATAR_KEYS,
  avatarSource,
  stickerAvatarValue,
} from '@/lib/avatars';
import { STICKER_IDS, stickerSource } from '@/lib/stickers';
import { COLORS } from '@/lib/theme';

interface AvatarItem {
  key: string;
  source: number;
}

/**
 * Galería de avatares: los 6 gradientes de siempre + todos los stickers de
 * `stick-it-up`. En TV usa `TvSheet` (Modal nativo: el D-pad queda dentro) y
 * en móvil un modal normal.
 */
export function AvatarPickerSheet({
  visible,
  value,
  onClose,
  onSelect,
}: {
  visible: boolean;
  value: string;
  onClose: () => void;
  onSelect: (avatar: string) => void;
}) {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const isTV = Platform.isTV;
  // Ancho fijo por celda: con `flex: 1` la última fila (incompleta) se estiraba
  // y los últimos stickers salían más grandes que el resto.
  const columns = isTV ? 8 : 5;
  const cellSize = Math.floor(width / columns);
  const items = useMemo<AvatarItem[]>(
    () => [
      ...AVATAR_KEYS.map((key) => ({ key, source: avatarSource(key) })),
      ...STICKER_IDS.map((id) => ({
        key: stickerAvatarValue(id),
        source: stickerSource(id) ?? avatarSource('black'),
      })),
    ],
    [],
  );
  const selectedIndex = Math.max(
    0,
    items.findIndex((item) => item.key === value),
  );
  // En TV el foco arranca en el avatar actual (o en el primero si la lista aún
  // no lo ha renderizado).
  const selectedRef = useRef<ComponentRef<typeof View>>(null);
  const firstRef = useRef<ComponentRef<typeof View>>(null);

  const content = (
    <>
      <View style={styles.panelHeader}>
        <Typography type="h5" weight="bold" style={{ flex: 1 }}>
          {t('Elegir avatar')}
        </Typography>
        <CloseButton onPress={onClose} />
      </View>
      <FlatList
        contentContainerStyle={{ padding: 10, paddingBottom: 28 }}
        data={items}
        key={isTV ? 'tv-grid' : 'mobile-grid'}
        keyExtractor={(item) => item.key}
        numColumns={columns}
        renderItem={({ item, index }) => (
          <View style={{ width: cellSize, padding: 6 }}>
            <AvatarCell
              itemRef={
                index === selectedIndex
                  ? selectedRef
                  : index === 0
                    ? firstRef
                    : undefined
              }
              selected={item.key === value}
              source={item.source}
              onPress={() => {
                onSelect(item.key);
                onClose();
              }}
            />
          </View>
        )}
      />
    </>
  );

  if (isTV) {
    return (
      <TvSheet
        firstFocusRef={selectedIndex < 24 ? selectedRef : firstRef}
        onClose={onClose}
        visible={visible}
      >
        {content}
      </TvSheet>
    );
  }

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
      transparent
      visible={visible}
    >
      <View style={styles.backdrop}>
        <Pressable onPress={onClose} style={StyleSheet.absoluteFill} />
        <SafeAreaView edges={['bottom']} style={styles.mobilePanel}>
          {content}
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function AvatarCell({
  source,
  selected,
  onPress,
  itemRef,
}: {
  source: number;
  selected: boolean;
  onPress: () => void;
  itemRef?: Ref<ComponentRef<typeof View>>;
}) {
  const { focused, focusProps } = useTvFocus();
  const highlighted = selected || focused;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      ref={itemRef}
      {...focusProps}
      style={[
        { borderRadius: 14, padding: 4 },
        tvFocusRing(focused),
      ]}
    >
      <View style={{ width: '100%', aspectRatio: 1 }}>
        <View
          style={{
            flex: 1,
            borderRadius: 999,
            overflow: 'hidden',
            borderWidth: 3,
            borderColor: highlighted ? '#4f9dff' : 'transparent',
          }}
        >
          <Image
            resizeMode="cover"
            source={source}
            style={{ width: '100%', height: '100%' }}
          />
        </View>
        {selected ? (
          <View style={styles.check}>
            <Check color="#000" size={12} />
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

function CloseButton({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation();
  const { focused, focusProps } = useTvFocus();
  return (
    <Pressable
      accessibilityLabel={t('Cerrar')}
      accessibilityRole="button"
      onPress={onPress}
      {...focusProps}
      style={[
        {
          width: 40,
          height: 40,
          borderRadius: 999,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'rgba(255,255,255,0.08)',
        },
        tvFocusRing(focused),
      ]}
    >
      <X color="#e5e5e5" size={18} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  mobilePanel: {
    maxHeight: '80%',
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 12,
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  check: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
