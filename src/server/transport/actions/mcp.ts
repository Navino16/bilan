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
import { PreferenceInputError, setMcpEnabled } from "@/server/services/users/preferences";
import { isMcpInstanceEnabled } from "@/server/mcp/switches";
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

// A token is a credential: same step-up as reading a secret (design §2). Fields are checked
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
    return {
      ok: false,
      error: e instanceof Error && e.message === "NOT_FOUND" ? "NOT_FOUND" : "FAILED",
    };
  }
}
