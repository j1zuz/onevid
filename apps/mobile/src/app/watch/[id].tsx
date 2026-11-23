import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { WatchPartyChatPanel } from '@/components/watch-party-chat-panel';
import { useWatchPartyChat } from '@/hooks/use-watch-party-chat';
import { getAccessToken } from '@/lib/auth';
import {
  joinWatchRoom,
  type WatchJoinData,
} from '@/lib/watch-party';

/**
 * Entrada a una sala de "Ver juntos" desde el móvil.
 *
 * - `onevid://watch/<id>` → abre el reproductor con `watch=<id>`: se ve la
 *   película y se chatea (host e invitados sincronizados).
 * - `onevid://watch/<id>?chat=1` → solo el chat. Es el QR de la TV, donde la
 *   película se ve en la tele y el móvil solo sirve para escribir.
 */
export default function WatchPartyScreen() {
  const { id, chat } = useLocalSearchParams<{ id?: string; chat?: string }>();
  const chatOnly = chat === '1';
  const [join, setJoin] = useState<WatchJoinData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    async function run() {
      if (!(await getAccessToken())) {
        if (!cancelled) setNeedsAuth(true);
        return;
      }
      try {
        const data = await joinWatchRoom(id as string);
        if (cancelled) return;
        if (chatOnly) {
          setJoin(data);
          return;
        }
        const room = data.room;
        if (room.isAddon) {
          setError('Las salas de complementos aún no se abren desde la app.');
          return;
        }
        router.replace({
          params: {
            background: room.background ?? undefined,
            episode: String(room.episode),
            id: room.contentId,
            poster: room.poster ?? undefined,
            season: String(room.season),
            title: room.title,
            type: room.contentType,
            watch: room.id,
          },
          pathname: '/player',
        });
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof Error ? e.message : 'No se pudo entrar a la sala.',
          );
        }
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [chatOnly, id]);

  const party = useWatchPartyChat({
    enabled: chatOnly && Boolean(join),
    fallbackName: 'Espectador',
    join: chatOnly ? join : null,
  });

  const close = useCallback(() => {
    void party.leave();
    if (router.canGoBack()) router.back();
    else router.replace('/home');
  }, [party]);

  if (needsAuth) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Inicia sesión para entrar</Text>
        <Text style={styles.text}>
          Entra con tu cuenta para ver y chatear en la sala.
        </Text>
        <Pressable
          onPress={() => router.replace('/welcome')}
          style={styles.primary}
        >
          <Text style={styles.primaryText}>Iniciar sesión</Text>
        </Pressable>
      </View>
    );
  }

  if (error || !id) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>No se pudo entrar</Text>
        <Text style={styles.text}>{error ?? 'Esta sala no existe.'}</Text>
        <Pressable onPress={close} style={styles.primary}>
          <Text style={styles.primaryText}>Cerrar</Text>
        </Pressable>
      </View>
    );
  }

  if (chatOnly && join) {
    return (
      <WatchPartyChatPanel
        error={party.error}
        members={party.members.length}
        messages={party.messages}
        onClose={close}
        onSend={party.sendMessage}
        ready={party.ready}
        sending={party.sending}
        title={join.room.title}
      />
    );
  }

  return (
    <View style={styles.center}>
      <ActivityIndicator color="#e5e7eb" />
      <Text style={styles.text}>
        {chatOnly ? 'Entrando al chat…' : 'Entrando a la sala…'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
    backgroundColor: '#0A0A0A',
    flex: 1,
    gap: 10,
    justifyContent: 'center',
    padding: 28,
  },
  title: { color: '#fafafa', fontSize: 20, fontWeight: '700' },
  text: { color: '#a1a1aa', fontSize: 14, textAlign: 'center' },
  primary: {
    backgroundColor: '#2563eb',
    borderRadius: 999,
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  primaryText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
