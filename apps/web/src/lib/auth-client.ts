import { apiKeyClient } from "@better-auth/api-key/client";
import { sentinelClient } from "@better-auth/infra/client";
import {
  deviceAuthorizationClient,
  magicLinkClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import type { AuthInstance } from "@/lib/auth";

export const authClient = createAuthClient({
  plugins: [
    sentinelClient(),
    apiKeyClient(),
    deviceAuthorizationClient(),
    magicLinkClient(),
  ],
  /**
   * Alinea tipos del cliente con `betterAuth({...})` vía `BetterAuthClientOptions["$InferAuth"]`
   * (ver `@better-auth/core`). El objeto vacío no sustituye la config en runtime; solo TypeScript.
   * Evita `import { auth }` por valor en el cliente (Resend/DB no deben entrar en el bundle).
   */
  $InferAuth: {} as AuthInstance["options"],
});
