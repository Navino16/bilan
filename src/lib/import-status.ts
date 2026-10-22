export const UNCOMMITTED_STATUSES = ["PARSING", "REVIEW", "FAILED"] as const;

export const canRevert = (status: string) => status === "COMPLETED";
export const canDiscard = (status: string) =>
  (UNCOMMITTED_STATUSES as readonly string[]).includes(status);

// An OFX commit that set an account's opening balance; kept so a revert can restore it.
export type BalanceAdjustment = { accountId: string; previous: number; set: number };

export type TrimmedMetadata = {
  fileSizeBytes: number | null;
  bank?: string | null;
  accountIds: string[];
  balanceAdjustments?: BalanceAdjustment[];
};

// Once committed, the raw payload (CSV text / parsed PDF rows) is plaintext bank
// data with no further use: only what the history needs is kept (spec §4.7).
export function trimBatchMetadata(meta: unknown, accountIds: string[]): TrimmedMetadata {
  const m = meta as {
    fileSizeBytes?: number;
    bank?: string | null;
    balanceAdjustments?: BalanceAdjustment[];
  } | null;
  return {
    fileSizeBytes: m?.fileSizeBytes ?? null,
    ...(m && "bank" in m ? { bank: m.bank ?? null } : {}),
    accountIds,
    ...(m?.balanceAdjustments ? { balanceAdjustments: m.balanceAdjustments } : {}),
  };
}
