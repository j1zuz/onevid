import { SvgXml } from 'react-native-svg';
import {
  badgeSparkleSvg,
  circleArrowRightSvg,
  docFolderSvg,
  heartSvg,
  houseSvg,
  inboxSvg,
  magnifierSvg,
  userSvg,
} from '@/lib/glass-icons-data';

export type GlassIconName =
  | 'house'
  | 'user'
  | 'magnifier'
  | 'doc-folder'
  | 'badge-sparkle'
  | 'inbox'
  | 'circle-arrow-right'
  | 'heart';

const SVGS: Record<GlassIconName, string> = {
  house: houseSvg,
  user: userSvg,
  magnifier: magnifierSvg,
  'doc-folder': docFolderSvg,
  'badge-sparkle': badgeSparkleSvg,
  inbox: inboxSvg,
  'circle-arrow-right': circleArrowRightSvg,
  heart: heartSvg,
};

export function GlassIcon({
  name,
  size = 24,
  opacity = 1,
}: {
  name: GlassIconName;
  size?: number;
  opacity?: number;
}) {
  return (
    <SvgXml xml={SVGS[name]} width={size} height={size} opacity={opacity} />
  );
}
