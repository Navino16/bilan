export const SUPPORTED_BANKS = ["revolut", "lcl"] as const;
export type BankKey = (typeof SUPPORTED_BANKS)[number];

// Fingerprints observed in the 4.3a samples (text extracted by pdf-parse):
// Revolut → "Revolut Bank UAB"; LCL → BIC "CRLYFRPP" or "Crédit Lyonnais"/"CREDIT LYONNAIS".
const FINGERPRINTS: Array<{ bank: BankKey; re: RegExp }> = [
  { bank: "revolut", re: /revolut/i },
  { bank: "lcl", re: /\bCRLYFRPP\b|cr[ée]dit\s+lyonnais|\bLCL\b/i },
];

export function detectBank(text: string): BankKey | null {
  for (const { bank, re } of FINGERPRINTS) {
    if (re.test(text)) return bank;
  }
  return null;
}
