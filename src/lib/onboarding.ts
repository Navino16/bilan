// ARCHIVED: the user can write to accounts, but all of them are archived.
export type AddTransactionBlocker = "NO_ACCOUNT" | "READ_ONLY" | "ARCHIVED";

export function addTransactionBlocker(
  hasAccount: boolean,
  writable: { archived: boolean } | null,
): AddTransactionBlocker | null {
  if (writable) return writable.archived ? "ARCHIVED" : null;
  return hasAccount ? "READ_ONLY" : "NO_ACCOUNT";
}

// Accounts a transaction can be added to: owned or WRITE-shared, and not archived.
export function writableActiveAccounts<T extends { access: string; archived: boolean }>(
  accounts: readonly T[],
): T[] {
  return accounts.filter((a) => !a.archived && (a.access === "OWNER" || a.access === "WRITE"));
}
