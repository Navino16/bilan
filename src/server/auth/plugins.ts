import { admin, twoFactor, openAPI } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";

// Passkey moved out of the better-auth core package into @better-auth/passkey
// (>= 1.6). The four plugins are loaded so their endpoints exist; the
// 2FA/passkey enrolment UI lands in Phase 8.4 (/settings/security).
export const authPlugins = [admin(), twoFactor(), passkey(), openAPI()];
