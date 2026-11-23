import { Image } from 'expo-image';
import { Button, Typography } from 'heroui-native';
import { Send, Share2, X } from 'lucide-react-native';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TvTextField } from '@/components/tv-text-field';
import { avatarSource } from '@/lib/avatars';
import type { WatchChatMessage } from '@/lib/watch-party';

/**
 * Chat compacto de "Ver juntos" (móvil). Filas de una sola línea con hora y
 * nombre para que quepan varios mensajes sin comer pantalla; los avatares son
 * los del perfil de onevid, igual que en la web.
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
  /** Presente solo para el host: comparte el enlace de la sala. */
  onShare?: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const listRef = useRef<FlatList<WatchChatMessage>>(null);

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    const ok = await onSend(text);
    if (!ok) setDraft(text);
  }, [draft, onSend]);

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
        <Typography align="center" color="muted" style={styles.notice} type="body-xs">
          {error}
        </Typography>
      ) : !ready ? (
        <View style={styles.center}>
          <ActivityIndicator color="#e5e7eb" />
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
          renderItem={({ item }) => <MessageRow message={item} />}
        />
      )}

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.composer}>
          <TvTextField
            autoCapitalize="sentences"
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

function MessageRow({ message }: { message: WatchChatMessage }) {
  const initials = message.userName.slice(0, 1).toUpperCase();
  const time = new Date(message.createdAt).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <View style={styles.message}>
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
      <View style={{ flex: 1 }}>
        <View style={styles.messageHead}>
          <Typography numberOfLines={1} type="body-xs" weight="semibold">
            {message.userName}
          </Typography>
          <Typography color="muted" type="body-xs">
            {time}
          </Typography>
        </View>
        <Typography type="body-sm">{message.text}</Typography>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: '#0A0A0A', flex: 1 },
  header: {
    alignItems: 'center',
    borderBottomColor: '#1f1f22',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  center: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  close: {
    alignItems: 'center',
    backgroundColor: '#1f1f22',
    borderRadius: 999,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  notice: { paddingHorizontal: 24, paddingTop: 24 },
  list: { flexGrow: 1, gap: 10, padding: 16 },
  message: { flexDirection: 'row', gap: 8 },
  messageHead: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  avatar: { backgroundColor: '#1f1f22', borderRadius: 999, height: 24, width: 24 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
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
    borderColor: '#27272a',
    borderRadius: 12,
    borderWidth: 1,
    color: '#e5e7eb',
    flex: 1,
    fontSize: 14,
    maxHeight: 96,
    minHeight: 40,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
});
