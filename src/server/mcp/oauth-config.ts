import { oauthProvider } from "@better-auth/oauth-provider";
import { env } from "@/env";
import { hmacExact } from "@/server/crypto/hmac";
import { searchKey } from "@/server/crypto/keys";

export const MCP_OAUTH_SCOPES = ["bilan:read", "bilan:write", "offline_access"] as const;
export const OAUTH_ACCESS_TOKEN_PREFIX = "bilan_oat_";
export const OAUTH_REFRESH_TOKEN_PREFIX = "bilan_ort_";
// The only plugin endpoints reachable over HTTP; the others are disabled (spec §5.18).
export const OAUTH_HTTP_PATHS: readonly string[] = [
  "/oauth2/authorize",
  "/oauth2/token",
  "/oauth2/register",
  "/oauth2/revoke",
];

const appUrl = env.APP_URL.replace(/\/$/, "");

export function mcpResourceUrl(): string {
  return `${appUrl}/api/mcp`;
}

export function oauthIssuer(): string {
  return `${appUrl}/api/auth`;
}

export function oauthTokenHash(token: string): string {
  return hmacExact(token, searchKey);
}

const consentUrl = `${appUrl}/oauth/consent`;

export const mcpOAuthProvider = oauthProvider({
  loginPage: consentUrl,
  consentPage: consentUrl,
  scopes: [...MCP_OAUTH_SCOPES],
  grantTypes: ["authorization_code", "refresh_token"],
  allowDynamicClientRegistration: true,
  allowUnauthenticatedClientRegistration: true,
  clientRegistrationDefaultApplicationType: "infer",
  disableJwtPlugin: true,
  storeTokens: { hash: (token) => oauthTokenHash(token) },
  prefix: {
    opaqueAccessToken: OAUTH_ACCESS_TOKEN_PREFIX,
    refreshToken: OAUTH_REFRESH_TOKEN_PREFIX,
  },
  resources: [
    { identifier: mcpResourceUrl(), name: "Bilan MCP", allowedScopes: [...MCP_OAUTH_SCOPES] },
  ],
  resourceSeedMode: "merge",
  enforcePerClientResources: false,
  accessTokenExpiresIn: 3600,
  refreshTokenExpiresIn: 30 * 86_400,
  codeExpiresIn: 600,
});

export type OAuthApi = {
  oauth2Consent(args: {
    body: { accept: boolean; scope?: string; oauth_query: string };
    headers: Headers;
  }): Promise<{ redirect: true; url: string }>;
  getOAuthServerConfig(): Promise<Record<string, unknown>>;
};

// getAuth()'s type is built without the plugins. Imported lazily: the auth module imports this one.
export async function oauthApi(): Promise<OAuthApi> {
  const { getAuth } = await import("@/server/auth");
  return (await getAuth()).api as unknown as OAuthApi;
}
