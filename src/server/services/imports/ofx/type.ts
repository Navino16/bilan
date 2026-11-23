import type { TransactionInput } from "@/lib/schemas/transaction";
import { deriveType } from "../derive-type";

type TxType = TransactionInput["type"];

const BY_TRNTYPE: Record<string, TxType> = {
  CHECK: "CHEQUE",
  ATM: "ATM",
  POS: "CARD",
  DIRECTDEBIT: "DIRECT_DEBIT",
  PAYMENT: "DIRECT_DEBIT",
  XFER: "TRANSFER",
};

// The label's own prefix wins (banks tag most rows DEBIT/CREDIT); TRNTYPE only settles what it leaves as OTHER.
export function ofxType(trnType: string | undefined, rawLabel: string): TxType {
  const derived = deriveType(rawLabel);
  if (derived !== "OTHER") return derived;
  return BY_TRNTYPE[(trnType ?? "").toUpperCase()] ?? "OTHER";
}
