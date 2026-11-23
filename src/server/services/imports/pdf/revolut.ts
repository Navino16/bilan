import { utcDayFromParts } from "../csv-parse";
import type { NormalizedRow, ParsedProduct } from "../types";

const FR_MONTHS: Record<string, number> = {
  "janv.": 1,
  "févr.": 2,
  mars: 3,
  "avr.": 4,
  mai: 5,
  juin: 6,
  "juil.": 7,
  août: 8,
  "sept.": 9,
  "oct.": 10,
  "nov.": 11,
  "déc.": 12,
};

const ROW = /^(\d{1,2}) ([A-Za-zà-ÿ.]+) (\d{4}) (.+)$/; // "<d> <month> <yyyy> <desc…>"
const FIRST_AMOUNT = /(\d[\d  ]*,\d{2})€/;
const AMOUNT = /(\d[\d  ]*,\d{2})€/g;

function toNumber(s: string): number {
  return Number(s.replace(/[  ]/g, "").replace(",", "."));
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function parseFrDate(day: string, month: string, year: string): Date | null {
  const m = FR_MONTHS[month.toLowerCase()];
  if (!m) return null;
  return utcDayFromParts(Number(year), m, Number(day));
}

// Opening balance per product, from the "Résumé du solde" table (first amount on
// the product's row), so each section's first row can be signed by its delta.
function readOpenings(lines: string[]): { compte: number | null; depot: number | null } {
  let compte: number | null = null;
  let depot: number | null = null;
  for (const line of lines) {
    if (/^Compte \(Compte courant\)/i.test(line))
      compte = toNumber(line.match(FIRST_AMOUNT)?.[1] ?? "0");
    else if (/^Dépôt\b/i.test(line)) depot = toNumber(line.match(FIRST_AMOUNT)?.[1] ?? "0");
  }
  return { compte, depot };
}

export function parseRevolutText(text: string): ParsedProduct[] {
  const lines = text
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const openings = readOpenings(lines);
  const products = new Map<string, NormalizedRow[]>();
  let key: string | null = null;
  let prev: number | null = null;

  for (const line of lines) {
    if (/^Transactions du compte/i.test(line)) {
      key = "compte";
      prev = openings.compte;
      if (!products.has(key)) products.set(key, []);
      continue;
    }
    if (/^Transactions de dépôt/i.test(line)) {
      key = "depot";
      prev = openings.depot;
      if (!products.has(key)) products.set(key, []);
      continue;
    }
    const m = ROW.exec(line);
    if (!m || key == null || prev == null || !FR_MONTHS[m[2].toLowerCase()]) continue;
    const amounts = [...line.matchAll(AMOUNT)].map((a) => toNumber(a[1]));
    if (amounts.length < 2) continue; // need movement + balance
    const balance = amounts[amounts.length - 1];
    const date = parseFrDate(m[1], m[2], m[3]);
    if (!date) continue;
    const rawLabel = m[4].replace(AMOUNT, "").replace(/€/g, "").replace(/\s+/g, " ").trim();
    if (!rawLabel) continue;
    products.get(key)!.push({ date, amount: round2(balance - prev), rawLabel });
    prev = balance;
  }

  return [...products.entries()]
    .filter(([, rows]) => rows.length)
    .map(([key, rows]) => ({ key, rows }));
}
