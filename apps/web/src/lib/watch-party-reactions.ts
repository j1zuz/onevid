/**
 * Reacciones por mensaje de la watch party.
 *
 * Stream valida el `type` de cada reacción: solo admite letras, números, `_`,
 * `-` y `.`, así que no se puede guardar el emoji directamente (la API responde
 * `reaction.type is not valid`). Se usa un alias estable por emoji, el mismo
 * criterio que `defaultReactionOptions` del SDK de Stream y que el chat de
 * hackw, para no dejar reacciones huérfanas si algún día se comparte el canal.
 *
 * `reactionEmoji`/`reactionType` son la traducción en los dos sentidos.
 */
export interface MessageReactionOption {
  emoji: string;
  label: string;
  type: string;
}

export const MESSAGE_REACTIONS: MessageReactionOption[] = [
  { emoji: "😂", label: "Risa", type: "haha" },
  { emoji: "👍", label: "Me gusta", type: "like" },
  { emoji: "❤️", label: "Me encanta", type: "love" },
  { emoji: "😔", label: "Triste", type: "sad" },
  { emoji: "😮", label: "Sorpresa", type: "wow" },
  { emoji: "🔥", label: "Fuego", type: "fire" },
];

/** Tipos extra que pueden llegar de un cliente antiguo o de otro canal. */
const EXTRA_ALIASES: Record<string, string> = {
  angry: "😡",
  clap: "👏",
  cry: "😢",
  heart_eyes: "😍",
};

const TYPE_TO_EMOJI: Record<string, string> = {
  ...Object.fromEntries(
    MESSAGE_REACTIONS.map((option) => [option.type, option.emoji])
  ),
  ...EXTRA_ALIASES,
};

const EMOJI_TO_TYPE: Record<string, string> = Object.fromEntries(
  MESSAGE_REACTIONS.map((option) => [option.emoji, option.type])
);

/** Emoji con el que se pinta un `type` guardado en Stream. */
export function reactionEmoji(type: string): string {
  return TYPE_TO_EMOJI[type] ?? type;
}

/** `type` válido para Stream a partir del emoji elegido en la UI. */
export function reactionType(emoji: string): string {
  const known = EMOJI_TO_TYPE[emoji];
  if (known) {
    return known;
  }
  const clean = emoji.replace(/[^\w.-]/g, "").slice(0, 24);
  return clean || "like";
}
