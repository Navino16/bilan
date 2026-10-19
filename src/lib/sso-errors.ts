// Error codes Better Auth appends (`?error=`) when an OAuth/OIDC sign-in or link callback fails.

export type SsoError =
  | "disabled"
  | "ssoFailed"
  | "ssoSignUpDisabled"
  | "ssoNotLinked"
  | "ssoDenied"
  | "ssoProvider"
  | "ssoExpired"
  | "ssoNoEmail";

export type LinkError =
  | "denied"
  | "provider"
  | "expired"
  | "noEmail"
  | "emailMismatch"
  | "linkedElsewhere"
  | "failed";

// Refused or cancelled at the IdP (RFC 6749 §4.1.2.1, OIDC Core §3.1.2.6).
const DENIED = ["access_denied", "login_required", "consent_required", "interaction_required"];
const EXPIRED = [
  "state_mismatch",
  "state_not_found",
  "state_security_mismatch",
  "please_restart_the_process",
];
const NO_EMAIL = ["email_not_found", "email_is_missing"];
const PROVIDER = [
  "invalid_code",
  "no_code",
  "oAuth_code_missing",
  "oauth_code_verification_failed",
  "unable_to_get_user_info",
  "user_info_is_missing",
  "name_is_missing",
  "issuer_mismatch",
  "issuer_missing",
  "nonce_binding_missing",
  "oauth_provider_not_found",
  "invalid_request",
  "unauthorized_client",
  "unsupported_response_type",
  "invalid_scope",
  "server_error",
  "temporarily_unavailable",
];

function groupOf(code: string): "denied" | "expired" | "noEmail" | "provider" | null {
  if (DENIED.includes(code)) return "denied";
  if (EXPIRED.includes(code)) return "expired";
  if (NO_EMAIL.includes(code)) return "noEmail";
  if (PROVIDER.includes(code)) return "provider";
  return null;
}

const LOGIN_BY_GROUP = {
  denied: "ssoDenied",
  expired: "ssoExpired",
  noEmail: "ssoNoEmail",
  provider: "ssoProvider",
} as const;

const LOGIN_SPECIFIC = new Map<string, SsoError>([
  ["BANNED_USER", "disabled"],
  ["signup_disabled", "ssoSignUpDisabled"],
  ["account_not_linked", "ssoNotLinked"],
]);

// Better Auth's origin check: the app was opened from another address than APP_URL.
const ORIGIN_ERRORS = ["INVALID_ORIGIN", "INVALID_CALLBACK_URL", "INVALID_ERROR_CALLBACK_URL"];

export function isOriginError(code: unknown): boolean {
  return typeof code === "string" && ORIGIN_ERRORS.includes(code);
}

export function loginSsoError(code: string): SsoError {
  const group = groupOf(code);
  return LOGIN_SPECIFIC.get(code) ?? (group ? LOGIN_BY_GROUP[group] : "ssoFailed");
}

const LINK_SPECIFIC = new Map<string, LinkError>([
  ["email_does_not_match", "emailMismatch"],
  ["account_already_linked_to_different_user", "linkedElsewhere"],
]);

// Every code Better Auth or an IdP is expected to send back; anything else is audited as "other".
const KNOWN = new Set([
  ...DENIED,
  ...EXPIRED,
  ...NO_EMAIL,
  ...PROVIDER,
  ...LOGIN_SPECIFIC.keys(),
  ...LINK_SPECIFIC.keys(),
  "unable_to_link_account",
  "no_callback_url",
  "invalid_callback_request",
]);

export function auditedSsoError(code: string): string {
  return KNOWN.has(code) ? code : "other";
}

export function linkSsoError(code: string): LinkError {
  return LINK_SPECIFIC.get(code) ?? groupOf(code) ?? "failed";
}
