import { BottomSheetFlatList } from '@gorhom/bottom-sheet';
import { BottomSheet, Typography } from 'heroui-native';
import { Check, ChevronDown, ListFilter, X } from 'lucide-react-native';
import {
  type ComponentRef,
  type Ref,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  FlatList,
  Platform,
  Pressable,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { TvSheet } from '@/components/tv-sheet';
import { tvFocusRing, useTvFocus } from '@/hooks/use-tv-focus';
import { COLORS } from '@/lib/theme';

// Clave centinela de "Todas": `group` vacío significa sin filtro.
export const ALL_GROUPS_KEY = '__all_groups__';

/**
 * Selector de categorías de Live TV: botón + hoja con la lista completa.
 *
 * En móvil usa el `BottomSheet` de HeroUI con `BottomSheetFlatList` (el gesto
 * de arrastre del sheet intercepta el scroll normal; `enableDynamicSizing` +
 * `enableOverDrag` apagados es el patrón que indica su doc).
 *
 * En TV usa `TvSheet` (un `Modal` nativo): el sheet de HeroUI vive en un portal
 * de JS y con el D-pad se podía seleccionar la pantalla de atrás.
 *
 * Vive en una barra fija sobre las pestañas (`bar`, móvil) o en el encabezado
 * de la guía (`pill`, TV).
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
  // Índice de la categoría activa dentro de la lista (0 = "Todas"): es donde
  // debe caer el foco al abrir la hoja en TV.
  const activeIndex = Math.max(
    0,
    items.findIndex((item) => item.key === (group || ALL_GROUPS_KEY)),
  );
  // Refs para dar foco al abrir la hoja de TV: la categoría activa si está
  // renderizada (la lista virtualiza desde el inicio) y si no, la primera.
  const activeRef = useRef<ComponentRef<typeof View>>(null);
  const firstRef = useRef<ComponentRef<typeof View>>(null);
  const firstFocusRef = activeIndex < 16 ? activeRef : firstRef;

  const triggerStyle: StyleProp<ViewStyle> = [
    {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      height: variant === 'bar' ? 44 : 32,
      paddingHorizontal: variant === 'bar' ? 14 : 10,
      borderRadius: variant === 'bar' ? 12 : 999,
      backgroundColor: COLORS.surface,
      // En TV (`pill`) el contenedor se mide por contenido y el Typography con
      // `flex: 1` aporta 0 de ancho intrínseco: el texto quedaba en 0 px y el
      // pill se veía solo con iconos. Con `minWidth` el texto recupera espacio.
      ...(variant === 'bar'
        ? { width: '100%' }
        : { minWidth: 190, maxWidth: 220 }),
    },
    tvFocusRing(focus.focused),
  ];

  const trigger = (
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
  );

  if (Platform.isTV) {
    return (
      <>
        {trigger}
        <TvSheet
          firstFocusRef={firstFocusRef}
          onClose={() => setOpen(false)}
          visible={open}
        >
          <View style={styles.header}>
            <Typography type="h5" weight="bold">
              {t('Categorías')}
            </Typography>
            <TvCloseButton onPress={() => setOpen(false)} />
          </View>
          <FlatList
            contentContainerStyle={{ paddingBottom: 24 }}
            data={items}
            initialNumToRender={16}
            keyExtractor={(item) => item.key}
            renderItem={({ item, index }) => (
              <CategoryOption
                itemRef={
                  index === activeIndex
                    ? activeRef
                    : index === 0
                      ? firstRef
                      : undefined
                }
                label={item.label}
                onPress={() => select(item.key)}
                selected={(group || ALL_GROUPS_KEY) === item.key}
              />
            )}
          />
        </TvSheet>
      </>
    );
  }

  return (
    <>
      {trigger}

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
              renderItem={({ item }) => (
                <CategoryOption
                  label={item.label}
                  onPress={() => select(item.key)}
                  selected={(group || ALL_GROUPS_KEY) === item.key}
                />
              )}
            />
          </BottomSheet.Content>
        </BottomSheet.Portal>
      </BottomSheet>
    </>
  );
}

/** Cierra la hoja en TV. Necesita su propio anillo para verse enfocado. */
function TvCloseButton({ onPress }: { onPress: () => void }) {
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
      <X size={18} color="#e5e5e5" />
    </Pressable>
  );
}

/**
 * Fila de categoría. En TV necesita estado de foco propio: el Pressable del
 * `FlatList` no lo trae y sin él el usuario no ve qué fila va a seleccionar.
 */
function CategoryOption({
  label,
  selected,
  onPress,
  itemRef,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  itemRef?: Ref<ComponentRef<typeof View>>;
}) {
  const { focused, focusProps } = useTvFocus();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      ref={itemRef}
      {...focusProps}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        minHeight: 48,
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: selected
          ? 'rgba(79,157,255,0.16)'
          : focused
            ? 'rgba(255,255,255,0.10)'
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
        {label}
      </Typography>
      {selected ? <Check size={16} color="#4f9dff" /> : null}
    </Pressable>
  );
}

const styles = {
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 8,
  },
} satisfies Record<string, ViewStyle>;
