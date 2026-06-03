import { tokenize } from "@/server/crypto/hmac";
import type { RuleMatchType } from "@/lib/validation/rule";

export type Rule = {
  id: string;
  categoryId: string;
  pattern: string;
  matchType: RuleMatchType;
  caseSensitive: boolean;
  priority?: number;
};

function prep(s: string, caseSensitive: boolean): string {
  return caseSensitive ? s : s.toLowerCase();
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
      try {
        return new RegExp(rule.pattern, rule.caseSensitive ? "" : "i").test(label);
      } catch {
        return false;
      }
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

// Suggests a rule pattern from a label for the learning dialog: the longest
// normalized token (most distinctive), as a case-insensitive CONTAINS rule.
export function proposeRule(
  rawLabel: string,
): { pattern: string; matchType: RuleMatchType } | null {
  const tokens = tokenize(rawLabel);
  if (tokens.length === 0) return null;
  const pattern = tokens.reduce((a, b) => (b.length > a.length ? b : a));
  return { pattern, matchType: "CONTAINS" };
}
