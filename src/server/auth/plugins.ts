import { admin, twoFactor, openAPI } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";
import { env } from "@/env";
import { authGuardPlugin } from "./login-guard";
import { TOTP_OPTIONS } from "./totp-replay";

const appUrl = new URL(env.APP_URL);

// Pin the WebAuthn origin to APP_URL instead of trusting the request's Origin header.
export const authPlugins = [
  admin(),
  twoFactor({ totpOptions: TOTP_OPTIONS }),
  passkey({ rpID: appUrl.hostname, origin: appUrl.origin }),
  authGuardPlugin,
  // The generated API reference (/api/auth/reference) is a dev aid, not public surface.
  ...(env.NODE_ENV === "production" ? [] : [openAPI()]),
];
