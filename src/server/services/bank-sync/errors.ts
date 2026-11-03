import { EnableBankingError, type BankSyncErrorCode } from "@/server/services/bank-sync/client";

export type BankSyncFlowCode =
  | "UNAVAILABLE"
  | "UNKNOWN_BANK"
  | "UNKNOWN_STATE"
  | "EXPIRED_STATE"
  | "WRONG_USER"
  | "DENIED"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "ALREADY_SYNCED"
  | "UNSUPPORTED_CURRENCY"
  | "RATE_LIMITED_LOCAL"
  | BankSyncErrorCode;

export class BankSyncError extends Error {
  constructor(readonly code: BankSyncFlowCode) {
    super(code);
    this.name = "BankSyncError";
  }
}

export function asBankSyncError(e: unknown): unknown {
  return e instanceof EnableBankingError ? new BankSyncError(e.code) : e;
}
