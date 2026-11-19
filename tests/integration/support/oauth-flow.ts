import { createHash, randomBytes } from "node:crypto";
import { env } from "@/env";
import { getAuth } from "@/server/auth";
import { GET, POST } from "@/app/api/auth/[...all]/route";
import { mcpResourceUrl, oauthApi } from "@/server/mcp/oauth-config";

const appUrl = env.APP_URL.replace(/\/$/, "");
const DEFAULT_REDIRECT_URI = "http://127.0.0.1:43123/callback";

export type OAuthTokens = {
  access_token: string;
  refresh_token?: string;
  scope: string;
  expires_in: number;
};

export async function signInCookie(email: string, password: string): Promise<string> {
  const auth = await getAuth();
  const res = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
  if (!res.ok) throw new Error(`sign-in failed: ${res.status}`);
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

export async function registerClient(
  opts: { redirectUri?: string; name?: string } = {},
): Promise<{ clientId: string; redirectUri: string }> {
  const redirectUri = opts.redirectUri ?? DEFAULT_REDIRECT_URI;
  const res = await POST(
    new Request(`${appUrl}/api/auth/oauth2/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: opts.name ?? "Test MCP client",
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      }),
    }),
  );
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${await res.text()}`);
  return { clientId: ((await res.json()) as { client_id: string }).client_id, redirectUri };
}

// Returns the signed query the plugin appends to the consent page redirect.
export async function authorize(opts: {
  clientId: string;
  redirectUri: string;
  cookie: string;
  scope: string;
}): Promise<{ oauthQuery: string; verifier: string; state: string }> {
  const verifier = randomBytes(32).toString("base64url");
  const state = randomBytes(8).toString("base64url");
  const query = new URLSearchParams({
    response_type: "code",
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    scope: opts.scope,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    state,
    resource: mcpResourceUrl(),
  });
  const res = await GET(
    new Request(`${appUrl}/api/auth/oauth2/authorize?${query}`, {
      headers: { cookie: opts.cookie },
    }),
  );
  const location = res.headers.get("location") ?? "";
  if (res.status !== 302 || !location.startsWith(`${appUrl}/oauth/consent?`)) {
    throw new Error(`authorize did not reach the consent page: ${res.status} ${location}`);
  }
  return { oauthQuery: new URL(location).search.slice(1), verifier, state };
}

export async function consent(opts: {
  oauthQuery: string;
  cookie: string;
  scope?: string;
}): Promise<{ code: string }> {
  const { url } = await (
    await oauthApi()
  ).oauth2Consent({
    body: {
      accept: true,
      oauth_query: opts.oauthQuery,
      ...(opts.scope ? { scope: opts.scope } : {}),
    },
    headers: new Headers({ cookie: opts.cookie }),
  });
  const code = new URL(url).searchParams.get("code");
  if (!code) throw new Error(`consent returned no code: ${url}`);
  return { code };
}

async function token(body: Record<string, string>): Promise<OAuthTokens> {
  const res = await POST(
    new Request(`${appUrl}/api/auth/oauth2/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
    }),
  );
  if (!res.ok) throw new Error(`token request failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as OAuthTokens;
}

export function exchangeCode(opts: {
  clientId: string;
  redirectUri: string;
  code: string;
  verifier: string;
}): Promise<OAuthTokens> {
  return token({
    grant_type: "authorization_code",
    code: opts.code,
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    code_verifier: opts.verifier,
    resource: mcpResourceUrl(),
  });
}

export function refreshTokens(opts: {
  clientId: string;
  refreshToken: string;
}): Promise<OAuthTokens> {
  return token({
    grant_type: "refresh_token",
    refresh_token: opts.refreshToken,
    client_id: opts.clientId,
    resource: mcpResourceUrl(),
  });
}
