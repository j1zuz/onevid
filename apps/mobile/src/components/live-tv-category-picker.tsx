import { BottomSheetFlatList } from '@gorhom/bottom-sheet';
import { BottomSheet, Typography } from 'heroui-native';
import { Check, ChevronDown, ListFilter } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { tvFocusRing, useTvFocus } from '@/hooks/use-tv-focus';
import { COLORS } from '@/lib/theme';

// Clave centinela de "Todas": `group` vacío significa sin filtro.
export const ALL_GROUPS_KEY = '__all_groups__';

/**
 * Selector de categorías de Live TV: botón + BottomSheet con la lista completa.
 *
 * La lista usa `BottomSheetFlatList` (no un FlatList/ScrollView de RN): el
 * gesto de arrastre del sheet intercepta el scroll normal, y con 122 categorías
 * no se podía bajar. `enableDynamicSizing={false}` + `enableOverDrag={false}` +
 * contenido acotado es el patrón que indica la doc de HeroUI/gorhom.
 *
 * En móvil vive en una barra fija sobre las pestañas (`bar`); en TV va en el
 * encabezado de la guía (`pill`).
 */
export function LiveTvCategoryPicker({
  group,
  groups,
  onChange,
  variant = 'pill',
}: {
  group: string;
  groups: string[];
  onChange: (group: string) => void;
  variant?: 'bar' | 'pill';
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const focus = useTvFocus();
  const items = useMemo(
    () => [
      { key: ALL_GROUPS_KEY, label: t('Todas las categorías') },
      ...groups.map((name) => ({ key: name, label: name })),
    ],
    [groups, t],
  );
  const select = (key: string) => {
    onChange(key === ALL_GROUPS_KEY ? '' : key);
    setOpen(false);
  };

  const triggerStyle: StyleProp<ViewStyle> = [
    {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      height: variant === 'bar' ? 44 : 32,
      paddingHorizontal: variant === 'bar' ? 14 : 10,
      borderRadius: variant === 'bar' ? 12 : 999,
      backgroundColor: COLORS.surface,
      ...(variant === 'bar' ? { width: '100%' } : { maxWidth: 150 }),
    },
    tvFocusRing(focus.focused),
  ];

  return (
    <>
      <Pressable
        accessibilityLabel={t('Categoría')}
        accessibilityRole="button"
        onPress={() => setOpen(true)}
        {...focus.focusProps}
        style={triggerStyle}
      >
        <ListFilter size={15} color="#a3a3a3" />
        <Typography
          type={variant === 'bar' ? 'body-sm' : 'body-xs'}
          numberOfLines={1}
          style={{ flex: 1, color: '#e5e5e5' }}
        >
          {group || t('Todas las categorías')}
        </Typography>
        <ChevronDown size={14} color="#a3a3a3" />
      </Pressable>

      <BottomSheet isOpen={open} onOpenChange={setOpen}>
        <BottomSheet.Portal>
          <BottomSheet.Overlay />
          <BottomSheet.Content
            contentContainerClassName="h-full"
            enableDynamicSizing={false}
            enableOverDrag={false}
            snapPoints={['75%']}
          >
            <View className="flex-row items-center justify-between px-4 pb-2">
              <BottomSheet.Title>{t('Categorías')}</BottomSheet.Title>
              <BottomSheet.Close />
            </View>
            <BottomSheetFlatList
              contentContainerStyle={{ paddingBottom: 32 }}
              data={items}
              initialNumToRender={16}
              keyExtractor={(item) => item.key}
              renderItem={({ item }) => {
                const selected = (group || ALL_GROUPS_KEY) === item.key;
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => select(item.key)}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 8,
                      minHeight: 48,
                      paddingHorizontal: 16,
                      paddingVertical: 12,
                      backgroundColor: selected
                        ? 'rgba(79,157,255,0.12)'
                        : 'transparent',
                    }}
                  >
                    <Typography
                      type="body-sm"
                      numberOfLines={1}
                      style={{
                        flex: 1,
                        color: selected ? '#4f9dff' : '#e5e5e5',
                        fontWeight: selected ? '600' : '400',
                      }}
                    >
                      {item.label}
                    </Typography>
                    {selected ? <Check size={16} color="#4f9dff" /> : null}
                  </Pressable>
                );
              }}
            />
          </BottomSheet.Content>
        </BottomSheet.Portal>
      </BottomSheet>
    </>
  );
}
