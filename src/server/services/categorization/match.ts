import { foldDiacritics } from "@/lib/text";
import type { RuleMatchType } from "@/lib/validation/rule";
import { compileRulePattern, createRegexCompiler } from "./regex";

export type Rule = {
  id: string;
  categoryId: string;
  pattern: string;
  matchType: RuleMatchType;
  caseSensitive: boolean;
  priority?: number;
  createdAt?: number;
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

// Negative when `a` wins: higher priority, then the longer (more specific) pattern, then the
// newer rule, then the id, so the winner never depends on database order (#287).
export function compareRules(
  a: Pick<Rule, "id" | "priority" | "pattern" | "createdAt">,
  b: Pick<Rule, "id" | "priority" | "pattern" | "createdAt">,
): number {
  return (
    (b.priority ?? 100) - (a.priority ?? 100) ||
    b.pattern.length - a.pattern.length ||
    (b.createdAt ?? 0) - (a.createdAt ?? 0) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

export function pickByPriority(rules: Rule[], label: string): Rule | null {
  let best: Rule | null = null;
  for (const r of rules) {
    if (!matchRule(r, label)) continue;
    if (!best || compareRules(r, best) < 0) best = r;
  }
  return best;
}

type Hay = { full: string; trimmed: string; trimmedStart: string };

// A label folded once for every rule: `sensitive` is the raw label, `insensitive` the form
// case-insensitive non-REGEX rules compare against (see `prep`).
export type PreparedLabel = { raw: string; sensitive: Hay; insensitive: Hay };

const hay = (s: string): Hay => ({ full: s, trimmed: s.trim(), trimmedStart: s.trimStart() });

export function prepareLabel(label: string): PreparedLabel {
  return { raw: label, sensitive: hay(label), insensitive: hay(prep(label, false)) };
}

export type PreparedRule = { rule: Rule; test: (label: PreparedLabel) => boolean };

// Same semantics as `matchRule`, with the pattern folded and the regex compiled up front.
function matcher(rule: Rule, compile: ReturnType<typeof createRegexCompiler>) {
  const needle = prep(rule.pattern, rule.caseSensitive);
  const side = rule.caseSensitive ? "sensitive" : "insensitive";
  switch (rule.matchType) {
    case "EXACT": {
      const trimmed = needle.trim();
      return (l: PreparedLabel) => l[side].trimmed === trimmed;
    }
    case "STARTS_WITH": {
      const trimmed = needle.trim();
      return (l: PreparedLabel) => l[side].trimmedStart.startsWith(trimmed);
    }
    case "CONTAINS":
      return (l: PreparedLabel) => l[side].full.includes(needle);
    case "REGEX": {
      const re = compile(rule.pattern, rule.caseSensitive);
      return re ? (l: PreparedLabel) => re.matcher(l.raw).find() : () => false;
    }
    default:
      return () => false;
  }
}

// Sorted with `compareRules` (stable sort), so the first rule matching a label is the one
// `pickByPriority` returns. For matching many labels against the same rules (#291).
export function prepareRules(rules: Rule[], compile = createRegexCompiler()): PreparedRule[] {
  return [...rules].sort(compareRules).map((rule) => ({ rule, test: matcher(rule, compile) }));
}

export function pickPrepared(prepared: PreparedRule[], label: PreparedLabel): Rule | null {
  for (const p of prepared) if (p.test(label)) return p.rule;
  return null;
}

// Lives in lib so the client list can use it without bundling re2js.
export { proposeRule } from "@/lib/propose-rule";
