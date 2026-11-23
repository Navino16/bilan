import { normalizeAmount, normalizeDate } from "../csv-parse";
import type { NormalizedRow } from "../types";

// Best-effort, bank-agnostic line grammar: "<dd/mm/yyyy> <label…> <amount>".
// Sign is taken as printed (no column info) — the preview lets the user fix it.
const LINE = /^(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+(-?[\d  ]+[.,]\d{2})\s*€?$/;

export function parseGenericText(text: string): NormalizedRow[] {
  const out: NormalizedRow[] = [];
  for (const raw of text.split("\n")) {
    const m = LINE.exec(raw.trim());
    if (!m) continue;
    const date = normalizeDate(m[1]);
    const amount = normalizeAmount(m[3]);
    const rawLabel = m[2].trim();
    if (!date || amount == null || !rawLabel) continue;
    out.push({ date, amount, rawLabel });
  }
  return out;
}
