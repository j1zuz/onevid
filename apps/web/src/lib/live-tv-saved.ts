/**
 * Los canales de Live TV no son media de TMDB y no tienen un id numérico.
 * Para guardarlos en la biblioteca usamos un id compuesto y estable:
 *
 *   `<sourceId>::<channelId>`
 *
 * El canal se resuelve de nuevo contra su fuente al abrirlo, así que no
 * guardamos URLs (pueden caducar o contener credenciales).
 */
export function buildLiveSavedId(
  sourceId: string,
  channelId: string
): string {
  return `${sourceId}::${channelId}`;
}

export function parseLiveSavedId(
  value: unknown
): { channelId: string; sourceId: string } | null {
  if (typeof value !== "string" || value.length > 500) return null;
  const parts = value.split("::");
  if (parts.length !== 2) return null;
  const sourceId = parts[0]?.trim();
  const channelId = parts[1]?.trim();
  if (!sourceId || !channelId) return null;
  if (sourceId.length > 200 || channelId.length > 200) return null;
  return { sourceId, channelId };
}
