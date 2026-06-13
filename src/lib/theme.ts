/**
 * Paleta dark-only de onevid.
 *
 * Uniwind / HeroUI Native respetan @variant light cuando el sistema reporta
 * light (Expo Go ignora userInterfaceStyle), por eso forzamos el background
 * vía style prop — la StyleSheet API tiene precedencia sobre className.
 */
export const COLORS = {
  background: '#0A0A0A',
  surface: '#171717',
} as const;
