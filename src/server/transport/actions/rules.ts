"use server";

import { requireSession } from "@/server/auth/permissions";
import { ruleInputSchema } from "@/lib/validation/rule";
import { createRule, RuleAccessError } from "@/server/services/categorization";

export type RuleActionState = { ok: true } | { ok: false; error: string } | null;

export async function createRuleAction(
  _prev: RuleActionState,
  formData: FormData,
): Promise<RuleActionState> {
  const user = await requireSession();
  const parsed = ruleInputSchema.safeParse({
    pattern: formData.get("pattern") ?? "",
    matchType: formData.get("matchType") ?? "CONTAINS",
    caseSensitive: formData.get("caseSensitive") === "true",
    priority: formData.get("priority") ?? 100,
    categoryId: formData.get("categoryId") ?? "",
    groupId: formData.get("groupId") ?? "",
  });
  if (!parsed.success) return { ok: false, error: "INVALID" };
  try {
    await createRule(parsed.data, { id: user.id });
  } catch (e) {
    return { ok: false, error: e instanceof RuleAccessError ? "FORBIDDEN" : "FAILED" };
  }
  return { ok: true };
}
