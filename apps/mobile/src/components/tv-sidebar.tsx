import { router, usePathname } from 'expo-router';
import { Typography } from 'heroui-native';
import { useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { TabIcon, type TabIconName } from '@/components/tab-icon';
import { tvFocusRing } from '@/hooks/use-tv-focus';
import { COLORS } from '@/lib/theme';

// Cerrado: franja invisible (overlay transparente, NO inseta el contenido, así
// no se ve nada). Solo sirve para que el D-pad pueda enfocar el rail.
const CLOSED_WIDTH = 24;
const OPEN_WIDTH = 210;

type TabHref = '/home' | '/discover' | '/library' | '/settings';

const ITEMS: { href: TabHref; name: TabIconName; label: string }[] = [
  { href: '/home', name: 'home', label: 'Inicio' },
  { href: '/discover', name: 'discover', label: 'Descubrir' },
  { href: '/library', name: 'library', label: 'Biblioteca' },
  { href: '/settings', name: 'settings', label: 'Configuración' },
];

/**
 * Rail de navegación para Android TV como **overlay** sobre el contenido (no
 * usa el slot del tab bar, por eso no deja borde visible cuando está cerrado).
 *
 * - Cerrado: una franja transparente de 24px, invisible, solo enfocable.
 * - Al enfocar con el D-pad se abre (210px, fondo sólido) con iconos + labels.
 * - Al salir del rail, se cierra.
 *
 * Navega con expo-router (router.navigate) y resalta el activo con usePathname.
 */
export function TvSidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const focusCount = useRef(0);

  const handleFocus = () => {
    focusCount.current += 1;
    setOpen(true);
  };
  const handleBlur = () => {
    focusCount.current = Math.max(0, focusCount.current - 1);
    // Retraso pequeño: al saltar entre items evita cerrar y reabrir.
    setTimeout(() => {
      if (focusCount.current === 0) setOpen(false);
    }, 60);
  };

  return (
    <View
      // box-none: la franja no bloquea el resto del contenido (solo sus hijos
      // son interactivos/enfocables).
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        bottom: 0,
        width: open ? OPEN_WIDTH : CLOSED_WIDTH,
        backgroundColor: open ? COLORS.background : 'transparent',
        justifyContent: 'center',
        paddingHorizontal: open ? 12 : 0,
        gap: open ? 8 : 0,
        zIndex: 50,
        elevation: 50,
      }}
    >
      {ITEMS.map((item) => {
        const active = pathname === item.href || pathname.startsWith(item.href);
        return (
          <Pressable
            key={item.href}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onPress={() => router.navigate(item.href)}
            style={(s) => {
              const focused = (s as { focused?: boolean }).focused ?? false;
              if (!open) {
                // Cerrado: zona de foco invisible, sin contenido.
                return { width: '100%', height: 48 };
              }
              // Sin fondo azul: el activo se distingue por el icono/texto y el
              // enfocado por el mismo anillo de foco que el resto de la app.
              return [
                {
                  flexDirection: 'row',
                  alignItems: 'center',
                  alignSelf: 'flex-start',
                  gap: 14,
                  paddingVertical: 10,
                  paddingHorizontal: 16,
                  borderRadius: 999,
                },
                tvFocusRing(focused),
              ];
            }}
          >
            {open ? (
              <>
                <TabIcon name={item.name} focused={active} size={26} />
                <Typography
                  type="body"
                  weight={active ? 'semibold' : 'medium'}
                  numberOfLines={1}
                  style={{ color: '#fff' }}
                >
                  {item.label}
                </Typography>
              </>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}
