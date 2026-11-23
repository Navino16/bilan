import { foldDiacritics, MAX_SEARCH_PREFIX, MIN_SEARCH_WORD } from "@/lib/text";
import type { Rule } from "./match";

// A word of the pattern every matching label has at a word start, so its prefix is one of the
// label's search tokens (#302). After folding, a word the pattern opens with a separator starts
// a label word too; a STARTS_WITH or EXACT pattern also anchors its first word. A CONTAINS
// pattern's first word may sit inside a label word ("xcarrefour"), and REGEX is opaque: null.
export function ruleIndexTerm(rule: Pick<Rule, "pattern" | "matchType">): string | null {
  if (rule.matchType === "REGEX") return null;
  const folded = foldDiacritics(rule.pattern).toLowerCase();
  let best: string | null = null;
  for (const m of folded.matchAll(/[a-z0-9]+/g)) {
    const anchored = m.index > 0 || rule.matchType !== "CONTAINS";
    if (anchored && m[0].length >= MIN_SEARCH_WORD && m[0].length > (best?.length ?? 0)) {
      best = m[0];
    }
  }
  return best?.slice(0, MAX_SEARCH_PREFIX) ?? null;
}
