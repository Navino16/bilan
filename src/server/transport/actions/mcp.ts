"use server";

import { z } from "zod";
import { requireSession } from "@/server/auth/permissions";
import { currentStepUpSession } from "@/server/auth/step-up-session";
import { auditOrigin } from "@/server/http/audit-origin";
import {
  confirmStepUp,
  stepUpMethod,
  stepUpVia,
  type StepUpConfirmResult,
  type StepUpMethod,
} from "@/server/services/users/step-up";
import {
  PreferenceInputError,
  getMcpEnabled,
  setMcpEnabled,
} from "@/server/services/users/preferences";
import { isMcpInstanceEnabled } from "@/server/mcp/switches";
import {
  consentScope,
  denyOAuthConsent,
  grantOAuthConsent,
  parseConsentRequest,
} from "@/server/mcp/oauth-consent";
import { revokeOAuthGrant } from "@/server/mcp/oauth-grants";
import { authHeaders } from "@/server/http/auth-headers";
import { createMcpToken, mcpTokenFields, revokeMcpToken } from "@/server/mcp/tokens";
import { MCP_TOKEN_EXPIRY_CHOICES, mcpTokenExpiry } from "@/lib/validation/mcp-token";
import { invalidInput, type FormFailure } from "@/lib/validation/field-errors";
import { isLocale } from "@/lib/locale-negotiation";
import { defaultLocale } from "@/i18n/config";

export async function setMcpEnabledAction(
  enabled: boolean,
  locale: unknown,
): Promise<{ ok: true } | { ok: false; error: "INSTANCE_DISABLED" | "FAILED" }> {
  const user = await requireSession();
  if (typeof enabled !== "boolean") return { ok: false, error: "FAILED" };
  if (enabled && !(await isMcpInstanceEnabled())) return { ok: false, error: "INSTANCE_DISABLED" };
  try {
    await setMcpEnabled(user.id, enabled, isLocale(locale) ? locale : defaultLocale);
    return { ok: true };
  } catch {
    return { ok: false, error: "FAILED" };
  }
}

export type CreateMcpTokenState =
  | { ok: true; token: string }
  | { ok: false; error: "REAUTH_REQUIRED"; method: StepUpMethod }
  | Exclude<StepUpConfirmResult, { ok: true }>
  | FormFailure;

const createInputSchema = z.object({
  ...mcpTokenFields,
  expiresInDays: z.enum(MCP_TOKEN_EXPIRY_CHOICES, { error: "INVALID" }),
});

const createRefused = { action: "mcp.token.create_failed", entity: "McpToken" };

// A token is a credential: same step-up as reading a secret (spec §6.4). Fields are checked
// first so the password is never asked for a form that can't succeed.
export async function createMcpTokenAction(
  input: { name: string; scope: string; expiresInDays: string },
  password?: unknown,
): Promise<CreateMcpTokenState> {
  await requireSession();
  const session = await currentStepUpSession();
  if (!session) return { ok: false, error: "FAILED" };
  const parsed = createInputSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error, input);
  if (!(await stepUpVia(session))) {
    if (typeof password !== "string" || !password) {
      return { ok: false, error: "REAUTH_REQUIRED", method: await stepUpMethod(session.userId) };
    }
    const step = await confirmStepUp(session, password, createRefused, await auditOrigin());
    if (!step.ok) return step;
  }
  const { name, scope, expiresInDays } = parsed.data;
  try {
    const expiresAt = mcpTokenExpiry(expiresInDays, new Date());
    const { token } = await createMcpToken(
      session.userId,
      { name, scope, expiresAt },
      { ...(await auditOrigin()), via: await stepUpVia(session) },
    );
    return { ok: true, token };
  } catch (e) {
    if (e instanceof PreferenceInputError) {
      return { ok: false, error: "INVALID", fieldErrors: e.fieldErrors };
    }
    return { ok: false, error: "FAILED" };
  }
}

const tokenIdSchema = z.string().min(1).max(191);

export async function revokeMcpTokenAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: "NOT_FOUND" | "FAILED" }> {
  const user = await requireSession();
  const parsed = tokenIdSchema.safeParse(id);
  if (!parsed.success) return { ok: false, error: "NOT_FOUND" };
  try {
    await revokeMcpToken(user.id, parsed.data);
    return { ok: true };
  } catch (e) {
    if (e instanceof Error && e.message === "NOT_FOUND") return { ok: false, error: "NOT_FOUND" };
    console.error("[bilan] revoke MCP token failed", e instanceof Error ? e.name : typeof e);
    return { ok: false, error: "FAILED" };
  }
}

const clientIdSchema = z.string().min(1).max(191);

export async function revokeOAuthGrantAction(
  clientId: string,
): Promise<{ ok: true } | { ok: false; error: "NOT_FOUND" | "FAILED" }> {
  const user = await requireSession();
  const parsed = clientIdSchema.safeParse(clientId);
  if (!parsed.success) return { ok: false, error: "NOT_FOUND" };
  try {
    await revokeOAuthGrant(user.id, parsed.data);
    return { ok: true };
  } catch (e) {
    if (e instanceof Error && e.message === "NOT_FOUND") return { ok: false, error: "NOT_FOUND" };
    console.error("[bilan] revoke OAuth grant failed", e instanceof Error ? e.name : typeof e);
    return { ok: false, error: "FAILED" };
  }
}

export type ApproveOAuthConsentState =
  | { ok: true; url: string }
  | { ok: false; error: "REAUTH_REQUIRED"; method: StepUpMethod }
  | Exclude<StepUpConfirmResult, { ok: true }>
  | {
      ok: false;
      error:
        | "INSTANCE_DISABLED"
        | "MCP_DISABLED"
        | "EXPIRED"
        | "INVALID"
        | "NO_SCOPE"
        | "LOGIN_REQUIRED"
        | "FAILED";
    };

const oauthQuerySchema = z.string().min(1).max(8192);
const consentInputSchema = z.object({
  oauthQuery: oauthQuerySchema,
  access: z.enum(["read", "write"]),
});

// A grant with offline_access lives as long as a token: same step-up (spec §2b).
export async function approveOAuthConsentAction(
  input: { oauthQuery: string; access: "read" | "write" },
  password?: unknown,
): Promise<ApproveOAuthConsentState> {
  await requireSession();
  const session = await currentStepUpSession();
  if (!session) return { ok: false, error: "FAILED" };
  if (!(await isMcpInstanceEnabled())) return { ok: false, error: "INSTANCE_DISABLED" };
  const parsed = consentInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID" };
  const consent = await parseConsentRequest(new URLSearchParams(parsed.data.oauthQuery));
  if (!consent.ok) {
    return { ok: false, error: consent.error === "EXPIRED" ? "EXPIRED" : "INVALID" };
  }
  const { request } = consent;
  if (!(await getMcpEnabled(session.userId))) return { ok: false, error: "MCP_DISABLED" };
  const scope = consentScope(request.requested, parsed.data.access);
  if (!scope) return { ok: false, error: "NO_SCOPE" };
  if (!(await stepUpVia(session))) {
    if (typeof password !== "string" || !password) {
      return { ok: false, error: "REAUTH_REQUIRED", method: await stepUpMethod(session.userId) };
    }
    const target = {
      action: "mcp.client.authorize_failed",
      entity: "OauthClient",
      entityId: request.clientId,
    };
    const step = await confirmStepUp(session, password, target, await auditOrigin());
    if (!step.ok) return step;
  }
  try {
    return await grantOAuthConsent({
      userId: session.userId,
      request,
      scope,
      headers: await authHeaders(),
      audit: { ...(await auditOrigin()), via: await stepUpVia(session) },
    });
  } catch (e) {
    console.error("[bilan] OAuth consent failed", e instanceof Error ? e.name : typeof e);
    return { ok: false, error: "FAILED" };
  }
}

export async function denyOAuthConsentAction(
  oauthQuery: string,
): Promise<
  | { ok: true; url: string }
  | { ok: false; error: "INSTANCE_DISABLED" | "EXPIRED" | "INVALID" | "FAILED" }
> {
  await requireSession();
  if (!(await isMcpInstanceEnabled())) return { ok: false, error: "INSTANCE_DISABLED" };
  const parsed = oauthQuerySchema.safeParse(oauthQuery);
  if (!parsed.success) return { ok: false, error: "INVALID" };
  const consent = await parseConsentRequest(new URLSearchParams(parsed.data));
  if (!consent.ok) {
    return { ok: false, error: consent.error === "EXPIRED" ? "EXPIRED" : "INVALID" };
  }
  try {
    return {
      ok: true,
      url: await denyOAuthConsent(consent.request.oauthQuery, await authHeaders()),
    };
  } catch (e) {
    console.error("[bilan] OAuth consent failed", e instanceof Error ? e.name : typeof e);
    return { ok: false, error: "FAILED" };
  }
}
