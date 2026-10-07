import { foldDiacritics } from "@/lib/text";
import type { RuleMatchType } from "@/lib/validation/rule";
import { compileRulePattern } from "./regex";

export type Rule = {
  id: string;
  categoryId: string;
  pattern: string;
  matchType: RuleMatchType;
  caseSensitive: boolean;
  priority?: number;
};

// Case-insensitive non-REGEX rules also ignore accents: bank labels are often
// "CREME" for "Crème" (#161). REGEX rules stay accent-sensitive.
function prep(s: string, caseSensitive: boolean): string {
  return caseSensitive ? s : foldDiacritics(s).toLowerCase();
}

// Pure predicate: does `label` satisfy this rule? Never throws (a malformed
// REGEX yields false rather than crashing categorization of a whole import).
export function matchRule(rule: Rule, label: string): boolean {
  const hay = prep(label, rule.caseSensitive);
  const needle = prep(rule.pattern, rule.caseSensitive);
  switch (rule.matchType) {
    case "EXACT":
      return hay.trim() === needle.trim();
    case "STARTS_WITH":
      return hay.trimStart().startsWith(needle.trim());
    case "CONTAINS":
      return hay.includes(needle);
    case "REGEX":
      return compileRulePattern(rule.pattern, rule.caseSensitive)?.matcher(label).find() ?? false;
    default:
      return false;
  }
}

// Highest-priority matching rule (ties broken by array order, callers pre-sort).
export function pickByPriority(rules: Rule[], label: string): Rule | null {
  let best: Rule | null = null;
  for (const r of rules) {
    if (!matchRule(r, label)) continue;
    if (!best || (r.priority ?? 100) > (best.priority ?? 100)) best = r;
  }
  return best;
}

// Lives in lib so the client list can use it without bundling re2js.
export { proposeRule } from "@/lib/propose-rule";
