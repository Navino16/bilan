import { foldDiacritics } from "@/lib/text";
import type { RuleMatchType } from "@/lib/validation/rule";

export const ACCOUNT_TYPES = ["CHECKING", "SAVINGS", "CREDIT", "OTHER"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];
export const ACCOUNT_NAME_MAX = 100;
export const ACCOUNT_BANK_NAME_MAX = 100;
export const ACCOUNT_IBAN_MAX = 40;
export const MIRROR_PATTERN_MAX = 100;
export const MIRROR_MATCH_TYPES = ["CONTAINS", "EXACT"] as const satisfies readonly RuleMatchType[];
export type MirrorMatchType = (typeof MIRROR_MATCH_TYPES)[number];

export const toMirrorMatchType = (v: string): MirrorMatchType =>
  MIRROR_MATCH_TYPES.find((m) => m === v) ?? "CONTAINS";

const comparableName = (s: string) =>
  s
    .normalize("NFKC")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, " ")
    .trim();

export function confirmsAccountName(typed: string, name: string): boolean {
  return comparableName(typed) === comparableName(name);
}

// Savings accounts are usually named like the bank labels them: "Livret A" → "LIVRET A".
export function defaultMirrorPattern(name: string): string {
  return foldDiacritics(name).toUpperCase().trim().slice(0, MIRROR_PATTERN_MAX);
}
