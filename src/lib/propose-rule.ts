import { tokenize } from "@/lib/text";
import type { RuleMatchType } from "@/lib/validation/rule";

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
