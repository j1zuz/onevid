import type { ImageSourcePropType } from 'react-native';

export type AvatarKey =
  | 'blue'
  | 'green'
  | 'orange'
  | 'purple'
  | 'red'
  | 'black';

export const AVATAR_KEYS: AvatarKey[] = [
  'blue',
  'green',
  'orange',
  'purple',
  'red',
  'black',
];

const SOURCES: Record<AvatarKey, ImageSourcePropType> = {
  blue: require('@/assets/images/avatars/blue.jpg'),
  green: require('@/assets/images/avatars/green.jpg'),
  orange: require('@/assets/images/avatars/orange.jpg'),
  purple: require('@/assets/images/avatars/purple.jpg'),
  red: require('@/assets/images/avatars/red.jpg'),
  black: require('@/assets/images/avatars/black.jpg'),
};

export function avatarSource(key: string | undefined): ImageSourcePropType {
  return SOURCES[(key as AvatarKey) in SOURCES ? (key as AvatarKey) : 'black'];
}
