export const SUPPORTED_BANKS = ["revolut", "lcl"] as const;
export type BankKey = (typeof SUPPORTED_BANKS)[number];

// Fingerprints must match the statement ISSUER, never transaction content (an
// LCL statement can carry a "VIR REVOLUT" line, so a bare /revolut/ would
// misdetect it). Revolut → issuer legal name "Revolut Bank UAB"; LCL → BIC
// "CRLYFRPP" or the bank name "Crédit Lyonnais"/"CREDIT LYONNAIS".
const FINGERPRINTS: Array<{ bank: BankKey; re: RegExp }> = [
  { bank: "revolut", re: /Revolut Bank UAB/i },
  { bank: "lcl", re: /\bCRLYFRPP\b|cr[ée]dit\s+lyonnais/i },
];

export function detectBank(text: string): BankKey | null {
  for (const { bank, re } of FINGERPRINTS) {
    if (re.test(text)) return bank;
  }
  return null;
}
