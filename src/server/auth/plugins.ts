import { admin, twoFactor, openAPI } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";
import { env } from "@/env";

const appUrl = new URL(env.APP_URL);

// Pin the WebAuthn origin to APP_URL instead of trusting the request's Origin header.
export const authPlugins = [
  admin(),
  twoFactor(),
  passkey({ rpID: appUrl.hostname, origin: appUrl.origin }),
  openAPI(),
];
