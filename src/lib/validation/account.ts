export const ACCOUNT_TYPES = ["CHECKING", "SAVINGS", "CREDIT", "OTHER"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];
export const ACCOUNT_NAME_MAX = 100;
export const ACCOUNT_BANK_NAME_MAX = 100;
export const ACCOUNT_IBAN_MAX = 40;

const comparableName = (s: string) =>
  s
    .normalize("NFKC")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, " ")
    .trim();

export function confirmsAccountName(typed: string, name: string): boolean {
  return comparableName(typed) === comparableName(name);
}
