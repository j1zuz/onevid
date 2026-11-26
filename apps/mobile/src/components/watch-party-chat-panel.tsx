import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Button, Input, Skeleton, Typography } from 'heroui-native';
import { ImagePlus, Send, Share2, X } from 'lucide-react-native';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { avatarSource } from '@/lib/avatars';
import {
  WATCH_REACTIONS,
  type WatchChatMessage,
} from '@/lib/watch-party';

/**
 * Chat de "Ver juntos" en la app: mensajes con imagen, reacciones rápidas y
 * adjuntos desde la galería. Los componentes de entrada son los de HeroUI
 * Native (`Input`, `Button`) como en el resto de la app.
 */
export function WatchPartyChatPanel({
  title,
  members,
  messages,
  ready,
  sending,
  error,
  onClose,
  onSend,
  onSendImages,
  onToggleReaction,
  onShare,
}: {
  title: string;
  members: number;
  messages: WatchChatMessage[];
  ready: boolean;
  sending: boolean;
  error: string | null;
  onClose: () => void;
  onSend: (text: string) => Promise<boolean>;
  onSendImages: (
    files: { uri: string; name: string; type: string }[],
  ) => Promise<boolean>;
  onToggleReaction: (
    messageId: string,
    emoji: string,
    mine: boolean,
  ) => Promise<void>;
  /** Presente solo para el host: comparte el enlace de la sala. */
  onShare?: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const listRef = useRef<FlatList<WatchChatMessage>>(null);

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    const ok = await onSend(text);
    if (!ok) setDraft(text);
  }, [draft, onSend]);

  const handlePickImages = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsMultipleSelection: true,
      mediaTypes: ['images'],
      quality: 0.85,
      selectionLimit: 4,
    });
    if (result.canceled) return;
    const files = result.assets.map((asset, index) => ({
      name: asset.fileName ?? `imagen-${Date.now()}-${index}.jpg`,
      type: asset.mimeType ?? 'image/jpeg',
      uri: asset.uri,
    }));
    await onSendImages(files);
  }, [onSendImages]);

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.root}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Typography numberOfLines={1} type="body-sm" weight="semibold">
            {title}
          </Typography>
          <Typography color="muted" type="body-xs">
            {t('{{count}} personas en la sala', { count: members })}
          </Typography>
        </View>
        {onShare ? (
          <Pressable hitSlop={8} onPress={onShare} style={styles.close}>
            <Share2 color="#e5e7eb" size={18} />
          </Pressable>
        ) : null}
        <Pressable hitSlop={8} onPress={onClose} style={styles.close}>
          <X color="#e5e7eb" size={18} />
        </Pressable>
      </View>

      {error ? (
        <Typography
          align="center"
          color="muted"
          style={styles.notice}
          type="body-xs"
        >
          {error}
        </Typography>
      ) : !ready ? (
        <View style={styles.skeletons}>
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <View key={index} style={styles.skeletonRow}>
              <Skeleton style={{ borderRadius: 999, height: 24, width: 24 }} />
              <View style={{ flex: 1, gap: 6 }}>
                <Skeleton style={{ borderRadius: 4, height: 10, width: 90 }} />
                <Skeleton
                  style={{
                    borderRadius: 8,
                    height: 14,
                    width: index % 2 === 0 ? '85%' : '65%',
                  }}
                />
              </View>
            </View>
          ))}
        </View>
      ) : (
        <FlatList
          contentContainerStyle={styles.list}
          data={messages}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={
            <Typography align="center" color="muted" type="body-xs">
              {t('Aún no hay mensajes. Escribe el primero.')}
            </Typography>
          }
          onContentSizeChange={() =>
            listRef.current?.scrollToEnd({ animated: true })
          }
          ref={listRef}
          renderItem={({ item }) => (
            <MessageRow
              message={item}
              onTogglePicker={() =>
                setPickerFor((current) =>
                  current === item.id ? null : item.id,
                )
              }
              onToggleReaction={(emoji, mine) =>
                void onToggleReaction(item.id, emoji, mine)
              }
              pickerOpen={pickerFor === item.id}
            />
          )}
        />
      )}

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.composer}>
          <Button
            isDisabled={!ready || sending}
            onPress={() => void handlePickImages()}
            size="sm"
            variant="outline"
          >
            <ImagePlus color="#e5e7eb" size={16} />
          </Button>
          <Input
            className="flex-1"
            multiline
            onChangeText={setDraft}
            placeholder={t('Escribe un mensaje')}
            placeholderTextColor="#6b7280"
            style={styles.input}
            value={draft}
          />
          <Button
            isDisabled={!draft.trim() || sending}
            onPress={() => void handleSend()}
            size="sm"
          >
            <Send color="#fff" size={16} />
          </Button>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function MessageRow({
  message,
  pickerOpen,
  onTogglePicker,
  onToggleReaction,
}: {
  message: WatchChatMessage;
  pickerOpen: boolean;
  onTogglePicker: () => void;
  onToggleReaction: (emoji: string, mine: boolean) => void;
}) {
  const initials = message.userName.slice(0, 1).toUpperCase();
  const time = new Date(message.createdAt).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <Pressable onPress={onTogglePicker} style={styles.message}>
      {message.avatar ? (
        <Image source={avatarSource(message.avatar)} style={styles.avatar} />
      ) : message.userImage ? (
        <Image source={{ uri: message.userImage }} style={styles.avatar} />
      ) : (
        <View style={[styles.avatar, styles.avatarFallback]}>
          <Typography type="body-xs" weight="semibold">
            {initials}
          </Typography>
        </View>
      )}
      <View style={{ flex: 1, gap: 4 }}>
        <View style={styles.messageHead}>
          <Typography numberOfLines={1} type="body-xs" weight="semibold">
            {message.userName}
          </Typography>
          <Typography color="muted" type="body-xs">
            {time}
          </Typography>
        </View>

        {message.text ? (
          <Typography type="body-sm">{message.text}</Typography>
        ) : null}

        {message.attachments.map((attachment, index) =>
          attachment.imageUrl || attachment.assetUrl ? (
            <Image
              contentFit="cover"
              key={`${message.id}-${index}`}
              source={{ uri: attachment.imageUrl ?? attachment.assetUrl }}
              style={styles.attachment}
            />
          ) : null,
        )}

        {message.reactions.length > 0 ? (
          <View style={styles.reactions}>
            {message.reactions.map((reaction) => (
              <Pressable
                key={reaction.emoji}
                onPress={() => onToggleReaction(reaction.emoji, reaction.mine)}
                style={[
                  styles.reactionChip,
                  reaction.mine && styles.reactionChipMine,
                ]}
              >
                <Typography type="body-xs">
                  {reaction.emoji} {reaction.count}
                </Typography>
              </Pressable>
            ))}
          </View>
        ) : null}

        {pickerOpen ? (
          <View style={styles.reactions}>
            {WATCH_REACTIONS.map((emoji) => {
              const mine =
                message.reactions.find((item) => item.emoji === emoji)?.mine ??
                false;
              return (
                <Pressable
                  key={emoji}
                  onPress={() => onToggleReaction(emoji, mine)}
                  style={[
                    styles.reactionChip,
                    mine && styles.reactionChipMine,
                  ]}
                >
                  <Typography type="body-sm">{emoji}</Typography>
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: '#0A0A0A', flex: 1 },
  header: {
    alignItems: 'center',
    borderBottomColor: '#1f1f22',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  notice: { paddingHorizontal: 24, paddingTop: 24 },
  skeletons: { flex: 1, gap: 16, padding: 16 },
  skeletonRow: { flexDirection: 'row', gap: 8 },
  list: { flexGrow: 1, gap: 12, padding: 16 },
  message: { flexDirection: 'row', gap: 8 },
  messageHead: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  avatar: {
    backgroundColor: '#1f1f22',
    borderRadius: 999,
    height: 24,
    width: 24,
  },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  attachment: { borderRadius: 12, height: 160, width: 220 },
  reactions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  reactionChip: {
    backgroundColor: '#1f1f22',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  reactionChipMine: { backgroundColor: 'rgba(79,157,255,0.25)' },
  composer: {
    alignItems: 'flex-end',
    borderTopColor: '#1f1f22',
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  input: {
    backgroundColor: '#171717',
    color: '#e5e7eb',
    fontSize: 14,
    maxHeight: 96,
    minHeight: 40,
  },
  close: {
    alignItems: 'center',
    backgroundColor: '#1f1f22',
    borderRadius: 999,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
});
