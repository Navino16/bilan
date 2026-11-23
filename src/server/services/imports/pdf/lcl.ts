import { utcDayFromParts } from "../csv-parse";
import type { NormalizedRow } from "../types";
import type { TextItem } from "./extract";

const OP_DATE = /^(\d{2})\.(\d{2})$/; //         operation date "07.04" (DATE band, x<70)
const VAL_DATE = /^(\d{2})\.(\d{2})\.(\d{2})$/; // value date "07.04.26" (VALEUR band)
const AMOUNT = /^-?[\d  ]+,\d{2}$/; //           "1 095,88" / "93,39"

function toNumber(s: string): number {
  return Number(s.replace(/[  ]/g, "").replace(",", "."));
}

// Groups a page's items into visual rows by y (nearest existing row within 2 units).
function groupByRow(items: TextItem[]): TextItem[][] {
  const rows: { y: number; items: TextItem[] }[] = [];
  for (const it of items) {
    const row = rows.find((r) => Math.abs(r.y - it.y) <= 2);
    if (row) row.items.push(it);
    else rows.push({ y: it.y, items: [it] });
  }
  return rows.map((r) => r.items);
}

export function parseLclItems(items: TextItem[]): NormalizedRow[] {
  const out: NormalizedRow[] = [];
  const pages = new Map<number, TextItem[]>();
  for (const it of items) pages.set(it.page, [...(pages.get(it.page) ?? []), it]);

  for (const pageItems of pages.values()) {
    const debitH = pageItems.find((i) => i.str === "DEBIT");
    const creditH = pageItems.find((i) => i.str === "CREDIT");
    if (!debitH || !creditH) continue; // page has no transaction table

    for (const row of groupByRow(pageItems)) {
      const sorted = [...row].sort((a, b) => a.x - b.x);
      const op = sorted.find((i) => i.x < 70 && OP_DATE.test(i.str));
      const val = sorted.find((i) => i.x >= 340 && i.x < 420 && VAL_DATE.test(i.str));
      const amt = sorted.find((i) => i.x >= 420 && AMOUNT.test(i.str));
      if (!op || !val || !amt) continue; // skips header, ANCIEN/NOUVEAU SOLDE, footers

      const label = sorted
        .filter((i) => i.x >= 70 && i.x < 340)
        .map((i) => i.str)
        .join(" ")
        .trim();
      if (!label || /\bSOLDE\b/i.test(label)) continue;

      const vm = VAL_DATE.exec(val.str)!;
      const om = OP_DATE.exec(op.str)!;
      const year = 2000 + Number(vm[3]); // value date carries the year; op date the day/month
      const date = utcDayFromParts(year, Number(om[2]), Number(om[1]));
      if (!date) continue;

      const magnitude = toNumber(amt.str);
      const isCredit = Math.abs(amt.x - creditH.x) < Math.abs(amt.x - debitH.x);
      out.push({ date, amount: isCredit ? magnitude : -magnitude, rawLabel: label });
    }
  }
  return out;
}
