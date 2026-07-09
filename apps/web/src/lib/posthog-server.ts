import { PostHog } from "posthog-node";

const POSTHOG_CAPTURE_URL = "https://us.i.posthog.com/i/v0/e/";

/** Clave del feature flag que gatea la beta del chat de IA. */
export const AI_CHAT_BETA_FLAG = "ai-chat-beta";

interface CaptureInput {
  distinctId: string;
  event: string;
  properties?: Record<string, unknown>;
  timestamp?: Date;
}

export async function posthogServerCapture({
  event,
  distinctId,
  properties,
  timestamp,
}: CaptureInput): Promise<boolean> {
  const token = process.env.NEXT_PUBLIC_POSTHOG_TOKEN;
  if (!token) {
    return false;
  }
  try {
    const response = await fetch(POSTHOG_CAPTURE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: token,
        event,
        distinct_id: distinctId,
        properties: properties ?? {},
        timestamp: (timestamp ?? new Date()).toISOString(),
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

let flagClient: PostHog | null = null;

/** Cliente posthog-node singleton solo para evaluar feature flags server-side. */
function getFlagClient(): PostHog | null {
  const token = process.env.NEXT_PUBLIC_POSTHOG_TOKEN;
  if (!token) {
    return null;
  }
  if (!flagClient) {
    flagClient = new PostHog(token, { host: "https://us.i.posthog.com" });
  }
  return flagClient;
}

/**
 * ¿El usuario (distinctId = email) tiene activada la beta del chat de IA?
 * Evalúa el flag `ai-chat-beta` server-side. Devuelve false si falta el token o
 * el distinctId, de modo que la feature queda oculta por defecto.
 */
export async function isAiBetaEnabled(
  distinctId: string | undefined | null
): Promise<boolean> {
  if (!distinctId) {
    return false;
  }
  const ph = getFlagClient();
  if (!ph) {
    return false;
  }
  try {
    const flags = await ph.evaluateFlags(distinctId);
    return flags.isEnabled(AI_CHAT_BETA_FLAG);
  } catch {
    return false;
  }
}

/**
 * Inscribe (o saca) al usuario de la beta seteando la person property que libera
 * el flag. Durable y cross-device en PostHog; hay una pequeña latencia de
 * propagación antes de que `isAiBetaEnabled` lo refleje.
 */
export function setAiBetaEnrollment(
  distinctId: string,
  enabled: boolean
): Promise<boolean> {
  return posthogServerCapture({
    distinctId,
    event: "ai_chat_beta_enrollment",
    properties: {
      enabled,
      $set: { ai_chat_beta_optin: enabled ? "true" : "false" },
    },
  });
}
