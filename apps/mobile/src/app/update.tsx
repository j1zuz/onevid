import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  type AppUpdateInfo,
  canUpdateInApp,
  checkAppUpdate,
  downloadAndInstallUpdate,
  installedAppVersion,
} from '@/lib/app-update';
import { COLORS } from '@/lib/theme';

type Phase =
  | 'checking'
  | 'available'
  | 'downloading'
  | 'installing'
  | 'current'
  | 'unsupported'
  | 'error';

/**
 * Pantalla de actualización de la app Dev.
 *
 * Se abre sola al arrancar cuando `/api/onevid-app-update` reporta una versión
 * más nueva que la instalada, y también desde Configuración → "Buscar
 * actualizaciones". Descarga el APK y abre el instalador de Android, así los
 * testers se actualizan sin volver a pedirles el enlace.
 */
export default function UpdateScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{
    version?: string;
    url?: string;
    notes?: string;
  }>();

  // Si venimos del aviso (o de Configuración) los datos ya están en los params:
  // se usa como estado inicial y no hay que consultar nada al montar.
  const fromParams = useMemo<AppUpdateInfo | null>(() => {
    if (typeof params.version !== 'string' || typeof params.url !== 'string') {
      return null;
    }
    return {
      version: params.version,
      url: params.url,
      notes: typeof params.notes === 'string' ? params.notes : '',
    };
  }, [params.notes, params.url, params.version]);
  const [update, setUpdate] = useState<AppUpdateInfo | null>(fromParams);
  const [phase, setPhase] = useState<Phase>(
    fromParams ? 'available' : canUpdateInApp ? 'checking' : 'unsupported',
  );
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const installed = installedAppVersion();

  // Sin params (por ejemplo, abierta a mano) se consulta al montar. El setState
  // va dentro de la promesa, no en el cuerpo del efecto.
  useEffect(() => {
    if (fromParams || !canUpdateInApp) {
      return;
    }
    let active = true;
    checkAppUpdate()
      .then((found) => {
        if (!active) return;
        if (found) {
          setUpdate(found);
          setPhase('available');
        } else {
          setPhase('current');
        }
      })
      .catch(() => {
        if (active) setPhase('current');
      });
    return () => {
      active = false;
    };
  }, [fromParams]);

  // Botón "Buscar actualizaciones" de la propia pantalla.
  const handleCheck = useCallback(async () => {
    setPhase('checking');
    setUpdate(null);
    const found = await checkAppUpdate();
    if (found) {
      setUpdate(found);
      setPhase('available');
    } else {
      setPhase('current');
    }
  }, []);

  const handleInstall = useCallback(async () => {
    if (!update) {
      return;
    }
    setMessage(null);
    setProgress(0);
    setPhase('downloading');
    try {
      const result = await downloadAndInstallUpdate(update, (fraction) => {
        setProgress(fraction);
      });
      setMessage(
        result === 'installer'
          ? t('Instalador abierto. Confirma la instalación.')
          : t('Abrimos la descarga en el navegador.'),
      );
      setPhase('available');
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : t('No se pudo descargar la actualización.'),
      );
      setPhase('error');
    }
  }, [t, update]);

  const close = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/home');
  }, []);

  const busy = phase === 'downloading' || phase === 'installing';

  return (
    <SafeAreaView
      edges={['top', 'bottom']}
      style={{ backgroundColor: COLORS.background, flex: 1 }}
    >
      <View
        className="flex-1 items-center justify-center px-7"
        style={{ gap: 18 }}
      >
        <Image
          source={require('../../assets/images/onevid-icon-dev.png')}
          contentFit="cover"
          style={{ width: 88, height: 88, borderRadius: 22 }}
        />

        <View className="items-center" style={{ gap: 6 }}>
          <Text
            style={{
              color: '#fff',
              fontSize: 22,
              fontWeight: '700',
              textAlign: 'center',
            }}
          >
            {phase === 'current'
              ? t('Estás al día')
              : phase === 'unsupported'
                ? t('Actualiza desde la tienda')
                : t('Nueva versión disponible')}
          </Text>

          {update ? (
            <Text
              style={{
                color: '#9ca3af',
                fontSize: 14,
                textAlign: 'center',
              }}
            >
              {t('Instalada')} {installed} → {update.version}
            </Text>
          ) : (
            <Text
              style={{ color: '#9ca3af', fontSize: 14, textAlign: 'center' }}
            >
              {phase === 'checking'
                ? t('Buscando actualizaciones…')
                : t('Versión instalada') + ' ' + installed}
            </Text>
          )}
        </View>

        {update?.notes ? (
          <View
            style={{
              backgroundColor: 'rgba(255,255,255,0.06)',
              borderRadius: 16,
              maxWidth: 420,
              paddingHorizontal: 16,
              paddingVertical: 12,
              width: '100%',
            }}
          >
            <Text
              style={{ color: '#d1d5db', fontSize: 13, lineHeight: 19 }}
            >
              {update.notes}
            </Text>
          </View>
        ) : null}

        {phase === 'downloading' ? (
          <View style={{ width: '100%', maxWidth: 420, gap: 8 }}>
            <View
              style={{
                backgroundColor: 'rgba(255,255,255,0.12)',
                borderRadius: 999,
                height: 8,
                overflow: 'hidden',
              }}
            >
              <View
                style={{
                  backgroundColor: '#0879d1',
                  borderRadius: 999,
                  height: 8,
                  width: `${Math.round(progress * 100)}%`,
                }}
              />
            </View>
            <Text
              style={{ color: '#9ca3af', fontSize: 12, textAlign: 'center' }}
            >
              {t('Descargando…')} {Math.round(progress * 100)}%
            </Text>
          </View>
        ) : null}

        {phase === 'installing' ? (
          <Text style={{ color: '#9ca3af', fontSize: 13 }}>
            {t('Abriendo el instalador…')}
          </Text>
        ) : null}

        {message ? (
          <Text
            style={{
              color: phase === 'error' ? '#f87171' : '#9ca3af',
              fontSize: 13,
              textAlign: 'center',
            }}
          >
            {message}
          </Text>
        ) : null}
      </View>

      <View
        style={{
          alignItems: 'center',
          gap: 10,
          paddingBottom: 16,
          paddingHorizontal: 20,
        }}
      >
        {phase === 'available' || phase === 'error' ? (
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void handleInstall()}
            style={{
              alignItems: 'center',
              backgroundColor: '#0879d1',
              borderRadius: 24,
              justifyContent: 'center',
              minHeight: 46,
              paddingHorizontal: 20,
              width: '100%',
            }}
          >
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>
              {t('Descargar e instalar')}
            </Text>
          </Pressable>
        ) : null}

        {phase === 'current' || phase === 'unsupported' ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => void handleCheck()}
            style={{
              alignItems: 'center',
              backgroundColor: 'rgba(255,255,255,0.08)',
              borderRadius: 24,
              justifyContent: 'center',
              minHeight: 46,
              paddingHorizontal: 20,
              width: '100%',
            }}
          >
            <Text style={{ color: '#0879d1', fontSize: 16, fontWeight: '600' }}>
              {t('Buscar actualizaciones')}
            </Text>
          </Pressable>
        ) : null}

        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={close}
          style={{
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 40,
            opacity: busy ? 0.5 : 1,
            paddingHorizontal: 20,
          }}
        >
          <Text style={{ color: '#9ca3af', fontSize: 15 }}>
            {t('Más tarde')}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
