import { normalizeKeyLabel } from "@/server/services/transactions/secure-fields";

// LCL's remittance string holds 7 lines: operation family, card or cheque number, statement
// label (the OFX NAME, kept byte for byte), then details such as cardholder, FX and refs (#392).
const LCL_STATEMENT_LINE = 2;

// One-line shapes, for labels stored before #392 had their line breaks collapsed.
const LCL_COLLAPSED: RegExp[] = [
  /^CARTE\b.*?\b\d{7} (CB .*?\b\d{2}\/\d{2}\/\d{2})(?: |$)/,
  /^RETRAIT DAB \d{7} (CB RETRAIT DU \d{2}\/\d{2})(?: |$)/,
  /^\S+ SEPA RECU \S+ \S+ (PRLV SEPA .+?)(?= [A-Z]+\.[A-Z0-9]*\d| \.|$)/i,
  /^PRELEVEMENT DES \S+ (ECHEANCE PRET .+?)(?: \d{12,}\S*)?$/,
  /^VIREMENT(?: SEPA RECU| INSTANTANE| PERMANENT)? (.+?)(?: [A-Z]+\d[A-Z\d]{8,})?$/,
  // Statement line repeating its family line, e.g. fees.
  /^(.+?) (\1(?: .*)?)$/,
];

const isLcl = (aspspName: string) => /^LCL\b/i.test(aspspName.trim());

function lclCollapsed(label: string): string {
  const cheque = /^CHEQUE \S+ (\d+)$/.exec(label);
  if (cheque) return `CHEQUE ${cheque[1]}`;
  for (const re of LCL_COLLAPSED) {
    const m = re.exec(label);
    if (m) return m[m.length - 1];
  }
  return label;
}

function lclLabel(raw: string): string {
  const lines = raw.split(/\r?\n/).map((l) => l.trim());
  if (lines.length <= LCL_STATEMENT_LINE) return lclCollapsed(normalizeKeyLabel(raw));
  const [family, number] = lines;
  if (lines[LCL_STATEMENT_LINE]) return lines[LCL_STATEMENT_LINE];
  const cheque = /^CHEQUE\b/.test(family) && /\d+$/.exec(number);
  return cheque ? `CHEQUE ${cheque[0]}` : normalizeKeyLabel(family);
}

// Rewrites a bank's remittance text into its statement label, so synced rows match
// OFX/CSV imports and the user's rules.
export function normalizeBankLabel(raw: string, aspspName: string): string {
  return isLcl(aspspName) ? lclLabel(raw) : normalizeKeyLabel(raw);
}
