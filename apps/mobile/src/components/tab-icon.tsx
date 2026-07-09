import { GlassIcon, type GlassIconName } from '@/components/glass-icon';

export type TabIconName = 'home' | 'discover' | 'library' | 'settings';

const MAP: Record<TabIconName, GlassIconName> = {
  home: 'house',
  discover: 'magnifier',
  library: 'doc-folder',
  settings: 'user',
};

export function TabIcon({
  name,
  size = 26,
  focused,
}: {
  name: TabIconName;
  size?: number;
  focused: boolean;
}) {
  // Glass icons are full-color; dim the inactive ones to convey selection.
  return <GlassIcon name={MAP[name]} size={size} opacity={focused ? 1 : 0.45} />;
}
