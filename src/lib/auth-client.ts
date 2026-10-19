import { createAuthClient } from "better-auth/react";
import { genericOAuthClient, twoFactorClient } from "better-auth/client/plugins";
import { passkeyClient } from "@better-auth/passkey/client";

// This module runs in the browser, so it must NOT import the server `env`
// (which validates server-only secrets like DATABASE_URL and would throw in the
// client bundle). better-auth defaults baseURL to the current origin, which is
// what we want for this same-origin app.
export const authClient = createAuthClient({
  plugins: [twoFactorClient(), passkeyClient(), genericOAuthClient()],
});

export const { signIn, signOut } = authClient;
