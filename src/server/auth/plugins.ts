import { admin, twoFactor, openAPI } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";
import { env } from "@/env";
import { authGuardPlugin } from "./login-guard";
import { TOTP_OPTIONS } from "./totp-replay";

const appUrl = new URL(env.APP_URL);

// Pin the WebAuthn origin to APP_URL instead of trusting the request's Origin header.
export const authPlugins = [
  admin(),
  // Better Auth's per-account lockout would let anyone holding the password lock the owner
  // out; our limiter is per IP and account instead (spec §6.7, decision S2).
  twoFactor({ totpOptions: TOTP_OPTIONS, accountLockout: { enabled: false } }),
  passkey({ rpID: appUrl.hostname, origin: appUrl.origin }),
  authGuardPlugin,
  // The generated API reference (/api/auth/reference) is a dev aid, not public surface.
  ...(env.NODE_ENV === "production" ? [] : [openAPI()]),
];
