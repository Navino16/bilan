export const UNCOMMITTED_STATUSES = ["PARSING", "REVIEW", "FAILED"] as const;

export const canRevert = (status: string) => status === "COMPLETED";
export const canDiscard = (status: string) =>
  (UNCOMMITTED_STATUSES as readonly string[]).includes(status);

export type TrimmedMetadata = {
  fileSizeBytes: number | null;
  bank?: string | null;
  accountIds: string[];
};

// Once committed, the raw payload (CSV text / parsed PDF rows) is plaintext bank
// data with no further use: only what the history needs is kept (spec §4.7).
export function trimBatchMetadata(meta: unknown, accountIds: string[]): TrimmedMetadata {
  const m = meta as { fileSizeBytes?: number; bank?: string | null } | null;
  return {
    fileSizeBytes: m?.fileSizeBytes ?? null,
    ...(m && "bank" in m ? { bank: m.bank ?? null } : {}),
    accountIds,
  };
}
