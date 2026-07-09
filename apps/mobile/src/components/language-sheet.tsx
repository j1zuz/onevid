import { Typography } from 'heroui-native';
import { Check } from 'lucide-react-native';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { tvFocusRing, useTvFocus } from '@/hooks/use-tv-focus';
import {
  setLanguageOverride,
  useLanguageOverride,
} from '@/lib/i18n/language-preference';
import {
  SUPPORTED_LANGUAGES,
  type SupportedLanguage,
} from '@/lib/i18n/languages';

/**
 * Bottom sheet para elegir el idioma de la app. La selección se persiste y pasa
 * a mandar sobre el idioma del dispositivo (ver language-preference.ts). Se abre
 * desde el tab Perfil/Configuración.
 */
export function LanguageSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const override = useLanguageOverride();
  const current = override ?? undefined;

  const handleSelect = useCallback(
    async (code: SupportedLanguage) => {
      await setLanguageOverride(code);
      onClose();
    },
    [onClose],
  );

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
            <Typography type="h4" weight="bold" align="center">
              {t('Idioma')}
            </Typography>
          </View>

          <ScrollView
            style={{ maxHeight: 420 }}
            contentContainerStyle={{ paddingBottom: 8 }}
            showsVerticalScrollIndicator={false}
          >
            {SUPPORTED_LANGUAGES.map((lang) => (
              <LanguageRow
                key={lang.code}
                label={lang.label}
                selected={lang.code === current}
                onPress={() => handleSelect(lang.code)}
              />
            ))}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function LanguageRow({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { focused, focusProps } = useTvFocus();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      {...focusProps}
      style={[styles.row, tvFocusRing(focused)]}
    >
      <Typography
        type="body"
        weight={selected ? 'semibold' : 'normal'}
        style={{ color: '#fafafa', flex: 1 }}
      >
        {label}
      </Typography>
      {selected ? <Check size={20} color="#3b82f6" /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  sheet: {
    backgroundColor: '#161616',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 10,
    paddingBottom: 24,
    gap: 12,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 999,
    backgroundColor: '#3f3f46',
    marginBottom: 4,
  },
  header: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderRadius: 12,
  },
});
