import { createAuthClient } from "better-auth/react";
import { twoFactorClient, adminClient } from "better-auth/client/plugins";
import { passkeyClient } from "@better-auth/passkey/client";
import { env } from "@/env";

export const authClient = createAuthClient({
  baseURL: env.APP_URL,
  plugins: [twoFactorClient(), passkeyClient(), adminClient()],
});

export const { signIn, signOut, signUp, useSession } = authClient;
