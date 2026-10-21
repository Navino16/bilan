"use server";

import { z } from "zod";
import { requireSession } from "@/server/auth/permissions";
import { ruleInputSchema } from "@/lib/schemas/rule";
import { RULES_FILE_MAX_BYTES, RULES_FILE_MAX_RULES } from "@/lib/validation/rules-file";
import type { ImportDecisions } from "@/lib/rules-import";
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
import {
  commitRulesImport,
  previewRulesImport,
  type RulesImportPreview,
  type RulesImportResult,
} from "@/server/services/categorization/rules-import";

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

const ruleIdsSchema = z.array(z.string().min(1)).min(1).max(RULES_FILE_MAX_RULES);
const groupIdSchema = z.string().min(1).nullable();

export async function previewRulesApplicationAction(
  ruleIds: string[],
): Promise<{ ok: true; preview: RuleApplicationPreview } | { ok: false; error: string }> {
  const user = await requireSession();
  const ids = ruleIdsSchema.safeParse(ruleIds);
  if (!ids.success) return { ok: false, error: "INVALID" };
  try {
    return { ok: true, preview: await previewRulesApplication(ids.data, { id: user.id }) };
  } catch (e) {
    return { ok: false, error: ruleError(e) };
  }
}

export async function applyRulesAction(
  ruleIds: string[],
): Promise<{ ok: true; reclassified: number } | { ok: false; error: string }> {
  const user = await requireSession();
  const ids = ruleIdsSchema.safeParse(ruleIds);
  if (!ids.success) return { ok: false, error: "INVALID" };
  try {
    return { ok: true, ...(await applyRules(ids.data, { id: user.id })) };
  } catch (e) {
    return { ok: false, error: ruleError(e) };
  }
}

const importDecisionsSchema = z.object({
  categories: z.record(
    z.string(),
    z.discriminatedUnion("action", [
      z.object({ action: z.literal("create") }),
      z.object({ action: z.literal("map"), categoryId: z.string().min(1) }),
      z.object({ action: z.literal("ignore") }),
    ]),
  ),
  moves: z.array(z.string()).max(RULES_FILE_MAX_RULES),
});

function rulesFileError(text: unknown): string | null {
  if (typeof text !== "string") return "INVALID";
  return Buffer.byteLength(text, "utf8") > RULES_FILE_MAX_BYTES ? "TOO_LARGE" : null;
}

export async function previewRulesImportAction(
  text: string,
  groupId: string | null,
): Promise<{ ok: true; preview: RulesImportPreview } | { ok: false; error: string }> {
  const user = await requireSession();
  const error = rulesFileError(text);
  if (error) return { ok: false, error };
  const target = groupIdSchema.safeParse(groupId);
  if (!target.success) return { ok: false, error: "INVALID" };
  try {
    return {
      ok: true,
      preview: await previewRulesImport(text, { groupId: target.data }, { id: user.id }),
    };
  } catch (e) {
    return { ok: false, error: ruleError(e) };
  }
}

export async function importRulesAction(
  text: string,
  groupId: string | null,
  decisions: ImportDecisions,
): Promise<({ ok: true } & RulesImportResult) | { ok: false; error: string }> {
  const user = await requireSession();
  const error = rulesFileError(text);
  if (error) return { ok: false, error };
  const target = groupIdSchema.safeParse(groupId);
  const parsed = importDecisionsSchema.safeParse(decisions);
  if (!target.success || !parsed.success) return { ok: false, error: "INVALID" };
  try {
    return {
      ok: true,
      ...(await commitRulesImport(text, { groupId: target.data }, parsed.data, { id: user.id })),
    };
  } catch (e) {
    return { ok: false, error: ruleError(e) };
  }
}
