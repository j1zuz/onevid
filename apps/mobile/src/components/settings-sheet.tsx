import { Switch, Typography, useToast } from 'heroui-native';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TvTextField } from '@/components/tv-text-field';
import { tvFocusRing, useTvFocus } from '@/hooks/use-tv-focus';
import { apiFetch } from '@/lib/api';
import type { LiveTvSourceSummary } from '@/lib/live-tv';

/**
 * Hoja de configuración nativa.
 *
 * Sustituye al atajo que abría `/home/account` en el navegador: calidad de las
 * fuentes, claves de debrid, complementos y fuentes de Live TV se editan aquí y
 * se guardan en los mismos endpoints que usa la web, así que ambos clientes
 * comparten el estado.
 */

type QualityTier = '2160' | '1440' | '1080' | '720' | '480' | 'unknown';

interface QualityPref {
  enabled: boolean;
  tier: QualityTier;
}

interface Addon {
  id: string;
  baseUrl: string;
  manifestName: string | null;
  manifestVersion?: string | null;
  supportsStreams?: boolean | null;
}

const QUALITY_LABELS: Record<QualityTier, string> = {
  '2160': '4K',
  '1440': '1440p',
  '1080': '1080p',
  '720': '720p',
  '480': '480p',
  unknown: 'Otra',
};

// Mismo orden por defecto que la web: 1080p primero porque arranca antes y se
// sostiene mejor; 4K al final y se sube desde aquí si el usuario lo quiere.
const DEFAULT_ORDER: QualityPref[] = [
  { tier: '1080', enabled: true },
  { tier: '720', enabled: true },
  { tier: '1440', enabled: true },
  { tier: '2160', enabled: true },
  { tier: '480', enabled: true },
  { tier: 'unknown', enabled: true },
];

/**
 * Preset de filas de Descubrir. Vive duplicado a propósito: el endpoint no
 * expone los valores por defecto, solo los configurados. Si cambian en la web
 * hay que actualizarlos aquí (`DEFAULT_DISCOVER_ROWS` en lib/onevid-feed.ts).
 */
const DEFAULT_DISCOVER_ROWS = [
  { type: 'movie', catalog: 'trending', networkId: 213 },
  { type: 'series', catalog: 'trending', networkId: 213 },
  { type: 'movie', catalog: 'trending', networkId: 1024 },
  { type: 'series', catalog: 'trending', networkId: 2739 },
  { type: 'series', catalog: 'trending', networkId: 3186 },
];

type DebridProvider = 'realdebrid' | 'torbox';

export function SettingsSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [quality, setQuality] = useState<QualityPref[]>(DEFAULT_ORDER);
  const [addons, setAddons] = useState<Addon[]>([]);
  const [sources, setSources] = useState<LiveTvSourceSummary[]>([]);
  const [feedRows, setFeedRows] = useState<unknown[]>([]);
  const [hasDebrid, setHasDebrid] = useState<Record<DebridProvider, boolean>>({
    realdebrid: false,
    torbox: false,
  });
  const [addonUrl, setAddonUrl] = useState('');
  const [editingKey, setEditingKey] = useState<DebridProvider | null>(null);
  const [keyValue, setKeyValue] = useState('');
  const [liveOpen, setLiveOpen] = useState(false);
  const [liveType, setLiveType] = useState<'m3u' | 'xtream'>('m3u');
  const [liveName, setLiveName] = useState('');
  const [liveUrl, setLiveUrl] = useState('');
  const [liveUser, setLiveUser] = useState('');
  const [livePass, setLivePass] = useState('');
  const [busy, setBusy] = useState(false);

  const fail = useCallback(
    (e: unknown) => {
      toast.show({
        variant: 'danger',
        label: t('No se pudo guardar'),
        description:
          e instanceof Error
            ? e.message
            : t('Revisa tu conexión e intenta de nuevo.'),
      });
    },
    [t, toast],
  );

  // Carga todo al abrir: son endpoints baratos y así la hoja no muestra estados
  // intermedios distintos por sección.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;

    // Los resets viven dentro de `load` (asíncrona) para no disparar renders
    // encadenados desde el cuerpo del efecto.
    async function load() {
      setLoading(true);
      setEditingKey(null);
      setKeyValue('');
      setAddonUrl('');
      setLiveOpen(false);
      setLiveName('');
      setLiveUrl('');
      setLiveUser('');
      setLivePass('');

      const [qualityRes, addonsRes, rdRes, torboxRes, liveRes, feedRes] =
        await Promise.allSettled([
          apiFetch<{ order?: QualityPref[] }>('/api/onevid-quality'),
          apiFetch<{ items?: Addon[] }>('/api/onevid-addons'),
          apiFetch<{ hasKey?: boolean }>('/api/real-debrid-key'),
          apiFetch<{ hasKey?: boolean }>('/api/torbox-key'),
          apiFetch<{ sources?: LiveTvSourceSummary[] }>('/api/onevid-live-tv'),
          apiFetch<{ rows?: unknown[] }>('/api/onevid-feed'),
        ]);
      if (cancelled) return;
      if (qualityRes.status === 'fulfilled' && qualityRes.value.order?.length) {
        setQuality(qualityRes.value.order);
      }
      if (addonsRes.status === 'fulfilled') {
        setAddons(addonsRes.value.items ?? []);
      }
      if (liveRes.status === 'fulfilled') {
        setSources(liveRes.value.sources ?? []);
      }
      if (feedRes.status === 'fulfilled') {
        setFeedRows(feedRes.value.rows ?? []);
      }
      setHasDebrid({
        realdebrid:
          rdRes.status === 'fulfilled' ? Boolean(rdRes.value.hasKey) : false,
        torbox:
          torboxRes.status === 'fulfilled'
            ? Boolean(torboxRes.value.hasKey)
            : false,
      });
      setLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [visible]);

  const saveQuality = useCallback(
    async (next: QualityPref[]) => {
      const previous = quality;
      setQuality(next);
      try {
        await apiFetch('/api/onevid-quality', {
          method: 'PUT',
          body: JSON.stringify({ order: next }),
        });
      } catch (e) {
        setQuality(previous);
        fail(e);
      }
    },
    [fail, quality],
  );

  const move = useCallback(
    (index: number, delta: number) => {
      const target = index + delta;
      if (target < 0 || target >= quality.length) return;
      const next = [...quality];
      [next[index], next[target]] = [next[target], next[index]];
      void saveQuality(next);
    },
    [quality, saveQuality],
  );

  const toggle = useCallback(
    (index: number, enabled: boolean) => {
      const next = quality.map((item, i) =>
        i === index ? { ...item, enabled } : item,
      );
      void saveQuality(next);
    },
    [quality, saveQuality],
  );

  const saveKey = useCallback(
    async (provider: DebridProvider) => {
      const key = keyValue.trim();
      if (!key || busy) return;
      setBusy(true);
      try {
        await apiFetch(
          provider === 'torbox' ? '/api/torbox-key' : '/api/real-debrid-key',
          { method: 'POST', body: JSON.stringify({ key }) },
        );
        setHasDebrid((prev) => ({ ...prev, [provider]: true }));
        setEditingKey(null);
        setKeyValue('');
        toast.show({ variant: 'success', label: t('Cuenta conectada') });
      } catch (e) {
        fail(e);
      } finally {
        setBusy(false);
      }
    },
    [busy, fail, keyValue, t, toast],
  );

  const removeKey = useCallback(
    async (provider: DebridProvider) => {
      if (busy) return;
      setBusy(true);
      try {
        await apiFetch(
          provider === 'torbox' ? '/api/torbox-key' : '/api/real-debrid-key',
          { method: 'DELETE' },
        );
        setHasDebrid((prev) => ({ ...prev, [provider]: false }));
        toast.show({ variant: 'success', label: t('Cuenta desconectada') });
      } catch (e) {
        fail(e);
      } finally {
        setBusy(false);
      }
    },
    [busy, fail, t, toast],
  );

  const addAddon = useCallback(async () => {
    const baseUrl = addonUrl.trim();
    if (!baseUrl || busy) return;
    setBusy(true);
    try {
      const res = await apiFetch<{ item?: Addon }>('/api/onevid-addons', {
        method: 'POST',
        body: JSON.stringify({ baseUrl }),
      });
      if (res.item) setAddons((prev) => [res.item as Addon, ...prev]);
      setAddonUrl('');
      toast.show({ variant: 'success', label: t('Complemento añadido') });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }, [addonUrl, busy, fail, t, toast]);

  const removeAddon = useCallback(
    async (id: string) => {
      if (busy) return;
      setBusy(true);
      try {
        await apiFetch(`/api/onevid-addons/${encodeURIComponent(id)}`, {
          method: 'DELETE',
        });
        setAddons((prev) => prev.filter((item) => item.id !== id));
      } catch (e) {
        fail(e);
      } finally {
        setBusy(false);
      }
    },
    [busy, fail],
  );

  const addLiveSource = useCallback(async () => {
    const url = liveUrl.trim();
    if (!url || busy) return;
    setBusy(true);
    try {
      const body =
        liveType === 'xtream'
          ? {
              type: 'xtream' as const,
              name: liveName.trim() || undefined,
              serverUrl: url,
              username: liveUser.trim(),
              password: livePass,
            }
          : {
              type: 'm3u' as const,
              name: liveName.trim() || undefined,
              url,
            };
      const res = await apiFetch<{ source?: LiveTvSourceSummary }>(
        '/api/onevid-live-tv',
        { method: 'POST', body: JSON.stringify(body) },
      );
      if (res.source) setSources((prev) => [res.source as LiveTvSourceSummary, ...prev]);
      setLiveOpen(false);
      setLiveName('');
      setLiveUrl('');
      setLiveUser('');
      setLivePass('');
      toast.show({ variant: 'success', label: t('Fuente añadida') });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }, [busy, fail, liveName, livePass, liveType, liveUrl, liveUser, t, toast]);

  const removeLiveSource = useCallback(
    async (id: string) => {
      if (busy) return;
      setBusy(true);
      try {
        await apiFetch('/api/onevid-live-tv', {
          method: 'DELETE',
          body: JSON.stringify({ id }),
        });
        setSources((prev) => prev.filter((item) => item.id !== id));
      } catch (e) {
        fail(e);
      } finally {
        setBusy(false);
      }
    },
    [busy, fail],
  );

  const restoreDiscover = useCallback(async () => {
    if (busy) return;
    if (feedRows.length === 0) {
      // Sin las filas de Inicio no se puede hacer el PUT: el endpoint exige
      // `rows` y no queremos pisar el feed del usuario con un preset.
      toast.show({
        variant: 'danger',
        label: t('No se pudo guardar'),
        description: t('Revisa tu conexión e intenta de nuevo.'),
      });
      return;
    }
    setBusy(true);
    try {
      await apiFetch('/api/onevid-feed', {
        method: 'PUT',
        body: JSON.stringify({
          rows: feedRows,
          discoverRows: DEFAULT_DISCOVER_ROWS,
        }),
      });
      toast.show({
        variant: 'success',
        label: t('Filas de Descubrir restauradas'),
      });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }, [busy, fail, feedRows, t, toast]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Typography align="center" type="h4" weight="bold">
              {t('Configuración')}
            </Typography>
          </View>

          {loading ? (
            <View style={styles.loading}>
              <ActivityIndicator color="#e5e7eb" />
            </View>
          ) : (
            <ScrollView
              contentContainerStyle={styles.content}
              showsVerticalScrollIndicator={false}
              style={{ maxHeight: 520 }}
            >
              <SectionTitle>{t('Calidad de video')}</SectionTitle>
              <Typography color="muted" style={styles.hint} type="body-xs">
                {t(
                  'La primera calidad disponible es la que abre el reproductor. Desactiva las que no quieras recibir.',
                )}
              </Typography>
              <View style={styles.group}>
                {quality.map((item, index) => (
                  <QualityRow
                    enabled={item.enabled}
                    first={index === 0}
                    key={item.tier}
                    label={QUALITY_LABELS[item.tier] ?? item.tier}
                    last={index === quality.length - 1}
                    onDown={() => move(index, 1)}
                    onToggle={(value) => toggle(index, value)}
                    onUp={() => move(index, -1)}
                  />
                ))}
              </View>

              <SectionTitle>{t('Debrid')}</SectionTitle>
              {(['torbox', 'realdebrid'] as const).map((provider) => (
                <DebridRow
                  busy={busy}
                  connected={hasDebrid[provider]}
                  editing={editingKey === provider}
                  key={provider}
                  label={provider === 'torbox' ? 'TorBox' : 'Real-Debrid'}
                  onCancel={() => {
                    setEditingKey(null);
                    setKeyValue('');
                  }}
                  onChange={setKeyValue}
                  onEdit={() => {
                    setEditingKey(provider);
                    setKeyValue('');
                  }}
                  onRemove={() => void removeKey(provider)}
                  onSave={() => void saveKey(provider)}
                  value={editingKey === provider ? keyValue : ''}
                />
              ))}

              <SectionTitle>{t('Complementos')}</SectionTitle>
              <View style={styles.inputRow}>
                <TvTextField
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  onChangeText={setAddonUrl}
                  placeholder={t('URL del complemento')}
                  placeholderTextColor="#6b7280"
                  style={styles.input}
                  value={addonUrl}
                />
                <Pressable
                  accessibilityRole="button"
                  disabled={busy || !addonUrl.trim()}
                  onPress={() => void addAddon()}
                  style={[
                    styles.smallButton,
                    (busy || !addonUrl.trim()) && styles.smallButtonDisabled,
                  ]}
                >
                  <Plus color="#e5e7eb" size={16} />
                  <Typography type="body-xs" weight="medium">
                    {t('Añadir')}
                  </Typography>
                </Pressable>
              </View>
              {addons.length === 0 ? (
                <Typography color="muted" style={styles.hint} type="body-xs">
                  {t('Sin complementos configurados.')}
                </Typography>
              ) : (
                <View style={styles.group}>
                  {addons.map((addon) => (
                    <AddonRow
                      addon={addon}
                      key={addon.id}
                      onRemove={() => void removeAddon(addon.id)}
                    />
                  ))}
                </View>
              )}

              <SectionTitle>{t('Live TV')}</SectionTitle>
              {sources.length === 0 ? (
                <Typography color="muted" style={styles.hint} type="body-xs">
                  {t('Sin fuentes de Live TV.')}
                </Typography>
              ) : (
                <View style={styles.group}>
                  {sources.map((source) => (
                    <LiveSourceRow
                      key={source.id}
                      onRemove={() => void removeLiveSource(source.id)}
                      source={source}
                    />
                  ))}
                </View>
              )}
              <Pressable
                accessibilityRole="button"
                onPress={() => setLiveOpen((prev) => !prev)}
                style={[styles.smallButton, styles.addButton]}
              >
                <Plus color="#e5e7eb" size={16} />
                <Typography type="body-xs" weight="medium">
                  {t('Añadir fuente')}
                </Typography>
              </Pressable>
              {liveOpen ? (
                <View style={styles.card}>
                  <View style={styles.toggleRow}>
                    {(['m3u', 'xtream'] as const).map((type) => (
                      <Pressable
                        accessibilityRole="button"
                        key={type}
                        onPress={() => setLiveType(type)}
                        style={[
                          styles.chip,
                          liveType === type && styles.chipActive,
                        ]}
                      >
                        <Typography type="body-xs" weight="medium">
                          {type === 'm3u' ? 'M3U' : 'Xtream'}
                        </Typography>
                      </Pressable>
                    ))}
                  </View>
                  <TvTextField
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    onChangeText={setLiveUrl}
                    placeholder={
                      liveType === 'xtream'
                        ? t('Servidor (https://…)')
                        : t('URL de la lista M3U')
                    }
                    placeholderTextColor="#6b7280"
                    style={styles.input}
                    value={liveUrl}
                  />
                  {liveType === 'xtream' ? (
                    <>
                      <TvTextField
                        autoCapitalize="none"
                        autoCorrect={false}
                        onChangeText={setLiveUser}
                        placeholder={t('Usuario')}
                        placeholderTextColor="#6b7280"
                        style={styles.input}
                        value={liveUser}
                      />
                      <TvTextField
                        autoCapitalize="none"
                        autoCorrect={false}
                        onChangeText={setLivePass}
                        placeholder={t('Contraseña')}
                        placeholderTextColor="#6b7280"
                        secureTextEntry
                        style={styles.input}
                        value={livePass}
                      />
                    </>
                  ) : null}
                  <TvTextField
                    autoCapitalize="sentences"
                    onChangeText={setLiveName}
                    placeholder={t('Nombre (opcional)')}
                    placeholderTextColor="#6b7280"
                    style={styles.input}
                    value={liveName}
                  />
                  <Pressable
                    accessibilityRole="button"
                    disabled={busy || !liveUrl.trim()}
                    onPress={() => void addLiveSource()}
                    style={[
                      styles.smallButton,
                      styles.addButton,
                      (busy || !liveUrl.trim()) && styles.smallButtonDisabled,
                    ]}
                  >
                    <Typography type="body-xs" weight="medium">
                      {t('Guardar fuente')}
                    </Typography>
                  </Pressable>
                </View>
              ) : null}

              <SectionTitle>{t('Descubrir')}</SectionTitle>
              <Typography color="muted" style={styles.hint} type="body-xs">
                {t(
                  'Si Descubrir aparece vacío, restaura las filas predeterminadas.',
                )}
              </Typography>
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => void restoreDiscover()}
                style={[styles.smallButton, busy && styles.smallButtonDisabled]}
              >
                <Typography type="body-xs" weight="medium">
                  {t('Restaurar filas de Descubrir')}
                </Typography>
              </Pressable>
            </ScrollView>
          )}
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function SectionTitle({ children }: { children: string }) {
  return (
    <Typography
      color="muted"
      style={styles.sectionTitle}
      type="body-xs"
      weight="semibold"
    >
      {children}
    </Typography>
  );
}

function QualityRow({
  label,
  enabled,
  first,
  last,
  onToggle,
  onUp,
  onDown,
}: {
  label: string;
  enabled: boolean;
  first: boolean;
  last: boolean;
  onToggle: (value: boolean) => void;
  onUp: () => void;
  onDown: () => void;
}) {
  const upFocus = useTvFocus();
  const downFocus = useTvFocus();
  return (
    <View style={styles.row}>
      <Typography style={{ flex: 1 }} type="body-sm" weight="medium">
        {label}
      </Typography>
      <Pressable
        accessibilityRole="button"
        disabled={first}
        onPress={onUp}
        {...upFocus.focusProps}
        style={[
          styles.iconButton,
          first && styles.iconButtonDisabled,
          tvFocusRing(upFocus.focused),
        ]}
      >
        <ArrowUp color="#e5e7eb" size={16} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={last}
        onPress={onDown}
        {...downFocus.focusProps}
        style={[
          styles.iconButton,
          last && styles.iconButtonDisabled,
          tvFocusRing(downFocus.focused),
        ]}
      >
        <ArrowDown color="#e5e7eb" size={16} />
      </Pressable>
      <Switch isSelected={enabled} onSelectedChange={onToggle} />
    </View>
  );
}

function DebridRow({
  label,
  connected,
  editing,
  value,
  busy,
  onChange,
  onEdit,
  onCancel,
  onSave,
  onRemove,
}: {
  label: string;
  connected: boolean;
  editing: boolean;
  value: string;
  busy: boolean;
  onChange: (value: string) => void;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const actionFocus = useTvFocus();
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Typography type="body-sm" weight="medium">
            {label}
          </Typography>
          <Typography color="muted" type="body-xs">
            {connected ? t('Conectado') : t('Sin conectar')}
          </Typography>
        </View>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={connected ? onRemove : onEdit}
          {...actionFocus.focusProps}
          style={[styles.smallButton, tvFocusRing(actionFocus.focused)]}
        >
          <Typography type="body-xs" weight="medium">
            {connected ? t('Quitar') : t('Conectar')}
          </Typography>
        </Pressable>
      </View>
      {editing ? (
        <View style={styles.inputRow}>
          <TvTextField
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={onChange}
            placeholder={t('API key')}
            placeholderTextColor="#6b7280"
            secureTextEntry
            style={styles.input}
            value={value}
          />
          <Pressable
            accessibilityRole="button"
            disabled={busy || !value.trim()}
            onPress={onSave}
            style={[
              styles.smallButton,
              (busy || !value.trim()) && styles.smallButtonDisabled,
            ]}
          >
            <Typography type="body-xs" weight="medium">
              {t('Guardar')}
            </Typography>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={onCancel}
            style={styles.smallButton}
          >
            <Typography type="body-xs" weight="medium">
              {t('Cancelar')}
            </Typography>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function AddonRow({
  addon,
  onRemove,
}: {
  addon: Addon;
  onRemove: () => void;
}) {
  const focus = useTvFocus();
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Typography numberOfLines={1} type="body-sm" weight="medium">
          {addon.manifestName || addon.baseUrl}
        </Typography>
        <Typography color="muted" numberOfLines={1} type="body-xs">
          {addon.baseUrl}
        </Typography>
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={onRemove}
        {...focus.focusProps}
        style={[styles.iconButton, tvFocusRing(focus.focused)]}
      >
        <Trash2 color="#e5e7eb" size={16} />
      </Pressable>
    </View>
  );
}

function LiveSourceRow({
  source,
  onRemove,
}: {
  source: LiveTvSourceSummary;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const focus = useTvFocus();
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Typography numberOfLines={1} type="body-sm" weight="medium">
          {source.name}
        </Typography>
        <Typography color="muted" numberOfLines={1} type="body-xs">
          {t('{{count}} canales', { count: source.channelCount })} ·{' '}
          {source.type === 'xtream' ? 'Xtream' : 'M3U'}
        </Typography>
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={onRemove}
        {...focus.focusProps}
        style={[styles.iconButton, tvFocusRing(focus.focused)]}
      >
        <Trash2 color="#e5e7eb" size={16} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: 'rgba(0,0,0,0.7)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#171717',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingBottom: 8,
  },
  handle: {
    alignSelf: 'center',
    backgroundColor: '#3f3f46',
    borderRadius: 999,
    height: 4,
    marginTop: 10,
    width: 44,
  },
  header: { paddingBottom: 8, paddingHorizontal: 20, paddingTop: 14 },
  loading: { paddingVertical: 48 },
  content: { paddingBottom: 24, paddingHorizontal: 20 },
  sectionTitle: {
    letterSpacing: 1,
    marginBottom: 6,
    marginTop: 18,
    textTransform: 'uppercase',
  },
  hint: { marginBottom: 8 },
  group: {
    backgroundColor: '#0f0f10',
    borderColor: '#27272a',
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
  },
  card: {
    backgroundColor: '#0f0f10',
    borderColor: '#27272a',
    borderRadius: 14,
    borderWidth: 1,
    gap: 10,
    marginBottom: 8,
    padding: 12,
  },
  row: {
    alignItems: 'center',
    borderBottomColor: '#1f1f22',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  toggleRow: { flexDirection: 'row', gap: 8 },
  chip: {
    backgroundColor: '#1f1f22',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipActive: { backgroundColor: '#2f6fdb' },
  inputRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  addButton: {
    alignSelf: 'flex-start',
    marginTop: 10,
  },
  input: {
    backgroundColor: '#0f0f10',
    borderColor: '#27272a',
    borderRadius: 12,
    borderWidth: 1,
    color: '#e5e7eb',
    flex: 1,
    fontSize: 13,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  iconButton: {
    alignItems: 'center',
    backgroundColor: '#1f1f22',
    borderRadius: 10,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  iconButtonDisabled: { opacity: 0.3 },
  smallButton: {
    alignItems: 'center',
    backgroundColor: '#1f1f22',
    borderRadius: 10,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    minHeight: 34,
    paddingHorizontal: 12,
  },
  smallButtonDisabled: { opacity: 0.4 },
});
