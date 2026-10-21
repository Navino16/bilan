import type { TransactionInput } from "@/lib/schemas/transaction";

type TxType = TransactionInput["type"];

// Best-effort transaction type from a French bank label prefix. Imports carry no
// explicit type, but the statement label usually encodes it (CB…, PRLV…, VIR…).
const RULES: Array<{ re: RegExp; type: TxType }> = [
  { re: /ch[èe]que|\bCHQ\b/i, type: "CHEQUE" },
  { re: /retrait|\bDAB\b/i, type: "ATM" },
  { re: /^\s*(prlv|pr[ée]l[èe]vement|echeance|ech[ée]ance)/i, type: "DIRECT_DEBIT" },
  { re: /^\s*(vir|virement)\b/i, type: "TRANSFER" },
  { re: /^\s*(cb|carte)\b/i, type: "CARD" },
];

export function deriveType(rawLabel: string): TxType {
  for (const { re, type } of RULES) {
    if (re.test(rawLabel)) return type;
  }
  return "OTHER";
}
