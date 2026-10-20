"use server";

import { requireSession } from "@/server/auth/permissions";
import { ruleInputSchema } from "@/lib/validation/rule";
import { RULES_FILE_MAX_RULES } from "@/lib/validation/rules-file";
import {
  createRule,
  updateRule,
  deleteRule,
  toggleRule,
  RuleAccessError,
  RuleValidationError,
} from "@/server/services/categorization";
import {
  applyRule,
  applyRules,
  previewRuleApplication,
  previewRulesApplication,
  type RuleApplicationPreview,
} from "@/server/services/categorization/apply";

function ruleError(e: unknown): string {
  if (e instanceof RuleAccessError) return e.message === "NOT_FOUND" ? "NOT_FOUND" : "FORBIDDEN";
  if (e instanceof RuleValidationError) return e.message;
  return "FAILED";
}

export type RuleActionState = { ok: true } | { ok: false; error: string } | null;
// Create and edit return the rule id so the dialog can go on to the "apply to existing" step.
export type RuleSaveState = { ok: true; id: string } | { ok: false; error: string } | null;

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
  _prev: RuleSaveState,
  formData: FormData,
): Promise<RuleSaveState> {
  const user = await requireSession();
  const parsed = parseRule(formData);
  if (!parsed.success) return { ok: false, error: "INVALID" };
  try {
    const { id } = await createRule(parsed.data, { id: user.id });
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: ruleError(e) };
  }
}

export async function updateRuleAction(
  _prev: RuleSaveState,
  formData: FormData,
): Promise<RuleSaveState> {
  const user = await requireSession();
  const id = String(formData.get("id") ?? "");
  const parsed = parseRule(formData);
  if (!id || !parsed.success) return { ok: false, error: "INVALID" };
  try {
    await updateRule(id, parsed.data, { id: user.id });
  } catch (e) {
    return { ok: false, error: ruleError(e) };
  }
  return { ok: true, id };
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

export async function previewRuleApplicationAction(
  ruleId: string,
): Promise<{ ok: true; preview: RuleApplicationPreview } | { ok: false; error: string }> {
  const user = await requireSession();
  try {
    return { ok: true, preview: await previewRuleApplication(ruleId, { id: user.id }) };
  } catch (e) {
    return { ok: false, error: ruleError(e) };
  }
}

export async function applyRuleAction(
  ruleId: string,
): Promise<{ ok: true; reclassified: number } | { ok: false; error: string }> {
  const user = await requireSession();
  try {
    return { ok: true, ...(await applyRule(ruleId, { id: user.id })) };
  } catch (e) {
    return { ok: false, error: ruleError(e) };
  }
}

const validRuleIds = (ids: string[]) => ids.length > 0 && ids.length <= RULES_FILE_MAX_RULES;

export async function previewRulesApplicationAction(
  ruleIds: string[],
): Promise<{ ok: true; preview: RuleApplicationPreview } | { ok: false; error: string }> {
  const user = await requireSession();
  if (!validRuleIds(ruleIds)) return { ok: false, error: "INVALID" };
  try {
    return { ok: true, preview: await previewRulesApplication(ruleIds, { id: user.id }) };
  } catch (e) {
    return { ok: false, error: ruleError(e) };
  }
}

export async function applyRulesAction(
  ruleIds: string[],
): Promise<{ ok: true; reclassified: number } | { ok: false; error: string }> {
  const user = await requireSession();
  if (!validRuleIds(ruleIds)) return { ok: false, error: "INVALID" };
  try {
    return { ok: true, ...(await applyRules(ruleIds, { id: user.id })) };
  } catch (e) {
    return { ok: false, error: ruleError(e) };
  }
}
