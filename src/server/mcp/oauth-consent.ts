import { verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import { constantTimeEqual, makeSignature } from "better-auth/crypto";
import { env } from "@/env";
import { db } from "@/server/db";
import { logEvent } from "@/server/services/audit";
import { MCP_OAUTH_SCOPES, oauthApi, oauthConsentPageUrl } from "./oauth-config";
import { clientDisplayName, clientRedirectHost, redirectHost } from "./oauth-grants";

export type ConsentAccess = "read" | "write";

export type ConsentRequest = {
  oauthQuery: string;
  clientId: string;
  clientName: string | null;
  redirectHost: string;
  requested: { read: boolean; write: boolean; offline: boolean };
};

export type ConsentRequestError = "EXPIRED" | "INVALID" | "UNKNOWN_CLIENT";

// Codes the plugin sends to `onAPIError.errorURL` (the login page) when it can't trust the
// client's redirect URI.
export const OAUTH_AUTHORIZE_ERRORS = [
  "invalid_client",
  "invalid_redirect",
  "client_disabled",
  "unauthorized_client",
  "unsupported_response_type",
  "invalid_request",
  "invalid_scope",
  "access_denied",
] as const;

export type OAuthAuthorizeError = (typeof OAUTH_AUTHORIZE_ERRORS)[number];

export function isOAuthAuthorizeError(code: unknown): code is OAuthAuthorizeError {
  return (OAUTH_AUTHORIZE_ERRORS as readonly unknown[]).includes(code);
}

export function accessChoices(requested: ConsentRequest["requested"]): ConsentAccess[] {
  return [
    ...(requested.write ? ["write" as const] : []),
    ...(requested.read ? ["read" as const] : []),
  ];
}

// The plugin refuses a scope the client didn't request (spec §2).
export function consentScope(
  requested: ConsentRequest["requested"],
  access: ConsentAccess,
): string | null {
  if (access === "write" ? !requested.write : !requested.read) return null;
  const granted = {
    "bilan:read": requested.read,
    "bilan:write": access === "write",
    offline_access: requested.offline,
  };
  return MCP_OAUTH_SCOPES.filter((scope) => granted[scope]).join(" ");
}

// Same canonical form as the plugin's signParams; only used to tell EXPIRED from INVALID once
// verifyOAuthQueryParams has refused the query.
async function signatureMatches(params: URLSearchParams): Promise<boolean> {
  const sigs = params.getAll("sig");
  if (sigs.length !== 1) return false;
  const rest = [...params.entries()].filter(([key]) => key !== "sig");
  rest.sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0));
  const expected = await makeSignature(new URLSearchParams(rest).toString(), env.AUTH_SECRET);
  return constantTimeEqual(sigs[0], expected);
}

export async function parseConsentRequest(
  params: URLSearchParams,
): Promise<{ ok: true; request: ConsentRequest } | { ok: false; error: ConsentRequestError }> {
  const oauthQuery = params.toString();
  if (!(await verifyOAuthQueryParams(oauthQuery, env.AUTH_SECRET))) {
    const expired = Number(params.get("exp")) * 1000 < Date.now();
    return {
      ok: false,
      error: expired && (await signatureMatches(params)) ? "EXPIRED" : "INVALID",
    };
  }
  const clientId = params.get("client_id");
  if (!clientId) return { ok: false, error: "INVALID" };
  const client = await db.oauthClient.findUnique({
    where: { clientId },
    select: { name: true, redirectUris: true, disabled: true },
  });
  if (!client || client.disabled) return { ok: false, error: "UNKNOWN_CLIENT" };
  const redirectUri = params.get("redirect_uri");
  const host = redirectUri ? redirectHost(redirectUri) : clientRedirectHost(client.redirectUris);
  if (!host) return { ok: false, error: "INVALID" };
  const scopes = (params.get("scope") ?? "").split(" ");
  return {
    ok: true,
    request: {
      oauthQuery,
      clientId,
      clientName: clientDisplayName(client.name),
      redirectHost: host,
      requested: {
        read: scopes.includes("bilan:read"),
        write: scopes.includes("bilan:write"),
        offline: scopes.includes("offline_access"),
      },
    },
  };
}

export async function grantOAuthConsent(input: {
  userId: string;
  request: ConsentRequest;
  scope: string;
  headers: Headers;
  audit: { ipAddress: string | null; userAgent: string | null; via: string | null };
}): Promise<{ ok: true; url: string } | { ok: false; error: "LOGIN_REQUIRED" }> {
  const { request, scope } = input;
  const { url } = await (
    await oauthApi()
  ).oauth2Consent({
    body: { accept: true, scope, oauth_query: request.oauthQuery },
    headers: input.headers,
  });
  // prompt=login or max_age not met by this session: the plugin sends the user back to sign in.
  if (url.startsWith(`${oauthConsentPageUrl()}?`)) return { ok: false, error: "LOGIN_REQUIRED" };
  if (new URL(url, oauthConsentPageUrl()).searchParams.has("code")) {
    await logEvent({
      userId: input.userId,
      action: "mcp.client.authorized",
      entity: "OauthClient",
      entityId: request.clientId,
      ipAddress: input.audit.ipAddress,
      userAgent: input.audit.userAgent,
      metadata: {
        clientId: request.clientId,
        name: request.clientName,
        redirectHost: request.redirectHost,
        scopes: scope.split(" "),
        via: input.audit.via,
      },
    });
  }
  return { ok: true, url };
}

export async function denyOAuthConsent(oauthQuery: string, headers: Headers): Promise<string> {
  const { url } = await (
    await oauthApi()
  ).oauth2Consent({ body: { accept: false, oauth_query: oauthQuery }, headers });
  return url;
}
