"use server";

import { requireSession } from "@/server/auth/permissions";
import { ruleInputSchema } from "@/lib/validation/rule";
import {
  createRule,
  updateRule,
  deleteRule,
  toggleRule,
  RuleAccessError,
  RuleValidationError,
} from "@/server/services/categorization";

function ruleError(e: unknown): string {
  if (e instanceof RuleAccessError) return "FORBIDDEN";
  if (e instanceof RuleValidationError) return e.message;
  return "FAILED";
}

export type RuleActionState = { ok: true } | { ok: false; error: string } | null;

function parseRule(formData: FormData) {
  return ruleInputSchema.safeParse({
    pattern: formData.get("pattern") ?? "",
    matchType: formData.get("matchType") ?? "CONTAINS",
    caseSensitive: formData.get("caseSensitive") === "true",
    priority: formData.get("priority") || undefined,
    categoryId: formData.get("categoryId") ?? "",
    groupId: formData.get("groupId") ?? "",
  });
}

export async function createRuleAction(
  _prev: RuleActionState,
  formData: FormData,
): Promise<RuleActionState> {
  const user = await requireSession();
  const parsed = parseRule(formData);
  if (!parsed.success) return { ok: false, error: "INVALID" };
  try {
    await createRule(parsed.data, { id: user.id });
  } catch (e) {
    return { ok: false, error: ruleError(e) };
  }
  return { ok: true };
}

export async function updateRuleAction(
  _prev: RuleActionState,
  formData: FormData,
): Promise<RuleActionState> {
  const user = await requireSession();
  const id = String(formData.get("id") ?? "");
  const parsed = parseRule(formData);
  if (!id || !parsed.success) return { ok: false, error: "INVALID" };
  try {
    await updateRule(id, parsed.data, { id: user.id });
  } catch (e) {
    return { ok: false, error: ruleError(e) };
  }
  return { ok: true };
}

export async function deleteRuleAction(
  _prev: RuleActionState,
  formData: FormData,
): Promise<RuleActionState> {
  const user = await requireSession();
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "INVALID" };
  try {
    await deleteRule(id, { id: user.id });
  } catch (e) {
    return { ok: false, error: e instanceof RuleAccessError ? "FORBIDDEN" : "FAILED" };
  }
  return { ok: true };
}

export async function toggleRuleAction(id: string, enabled: boolean): Promise<RuleActionState> {
  const user = await requireSession();
  if (!id) return { ok: false, error: "INVALID" };
  try {
    await toggleRule(id, enabled, { id: user.id });
  } catch (e) {
    return { ok: false, error: e instanceof RuleAccessError ? "FORBIDDEN" : "FAILED" };
  }
  return { ok: true };
}
