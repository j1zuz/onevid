import { SkipForward } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTvFocus, tvFocusRing } from '@/hooks/use-tv-focus';

export interface NextEpisodeRef {
  name: string;
  number: number;
  season: number;
}

/**
 * Botón para saltar al episodio siguiente, que aparece cerca del final del que
 * se está viendo. Mismo comportamiento que `StreamNextEpisode` de la web: lo
 * pinta el reproductor solo en series y solo si de verdad hay un episodio
 * después (ver `useNextEpisode`).
 *
 * Se monta como hermano de los controles y NUNCA como prop de
 * `<LibVlcPlayerView>`: cualquier prop nuevo en esa vista la destruye y la
 * recrea, y con ella el stream (ver el comentario de VLC_OPTIONS en player.tsx).
 */
export function NextEpisodeButton({
  next,
  onPlay,
}: {
  next: NextEpisodeRef;
  onPlay: (next: NextEpisodeRef) => Promise<void> | void;
}) {
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const { focused, focusProps } = useTvFocus();

  async function handlePress() {
    if (loading) return;
    setLoading(true);
    setFailed(false);
    try {
      await onPlay(next);
      // Normalmente el botón se desmonta aquí (el episodio nuevo arranca desde
      // 0:00 y deja de estar "cerca del final"), pero si por lo que sea sigue
      // montado no debe quedarse girando.
      setLoading(false);
    } catch {
      // El episodio siguiente puede existir en TMDB y no tener medios todavía;
      // se avisa en el propio botón en vez de dejarlo girando.
      setFailed(true);
      setLoading(false);
    }
  }

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      {failed ? (
        <Text style={styles.error}>
          No hay medios para el siguiente episodio
        </Text>
      ) : null}
      <Pressable
        onPress={handlePress}
        disabled={loading}
        style={[styles.button, tvFocusRing(focused)]}
        {...focusProps}
      >
        {loading ? (
          <ActivityIndicator color="#000" size="small" />
        ) : (
          <SkipForward size={16} color="#000" fill="#000" />
        )}
        <Text numberOfLines={1} style={styles.label}>
          {failed
            ? 'Reintentar'
            : `Siguiente: T${next.season} E${next.number}`}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    right: 16,
    bottom: 96,
    alignItems: 'flex-end',
    gap: 6,
    zIndex: 25,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  label: { color: '#000', fontSize: 14, fontWeight: '600', maxWidth: 220 },
  error: {
    color: '#fff',
    fontSize: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
});
