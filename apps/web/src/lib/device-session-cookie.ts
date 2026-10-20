import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { z } from "zod";

const exchangeBodySchema = z.object({
  access_token: z.string().min(1),
});

/**
 * El flujo device/token solo devuelve un Bearer (session.token crudo). En un
 * navegador eso no basta: las páginas RSC leen la cookie firmada
 * `better-auth.session_token`. Este endpoint intercambia el access_token por
 * esa cookie vía `setSessionCookie` (mismo camino que sign-in / magic-link).
 *
 * Llamar a /get-session con Authorization: Bearer NO setea cookie: el plugin
 * bearer solo inyecta el token en los headers de esa request.
 */
export const deviceSessionCookie = (): BetterAuthPlugin => ({
  id: "device-session-cookie",
  endpoints: {
    exchangeDeviceSessionCookie: createAuthEndpoint(
      "/device/cookie",
      {
        method: "POST",
        body: exchangeBodySchema,
      },
      async (ctx) => {
        const { access_token: token } = exchangeBodySchema.parse(ctx.body);

        const session = await ctx.context.internalAdapter.findSession(token);
        if (!session || session.session.expiresAt < new Date()) {
          throw new APIError("UNAUTHORIZED", {
            message: "Invalid or expired session token",
          });
        }

        await setSessionCookie(ctx, session);
        return ctx.json({ success: true });
      }
    ),
  },
});
