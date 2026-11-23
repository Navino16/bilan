import { round2 } from "@/lib/budgets";
import { dayStart, isValidIsoDay, toIsoDay } from "@/lib/period";
import type { NormalizedRow } from "@/server/services/imports/types";
import { normalizeBankLabel } from "@/server/services/bank-sync/labels";
import type { EbBalance, EbTransaction } from "@/server/services/bank-sync/types";

export const SYNC_OVERLAP_DAYS = 7;
export const FIRST_FETCH_YEARS = 3;

const DAY_MS = 86_400_000;
const EMPTY_LABEL = "—";

const signed = (t: EbTransaction) =>
  (t.credit_debit_indicator === "DBIT" ? -1 : 1) * Number(t.transaction_amount.amount);

// Booked rows only; pending ones are summed for the account (design §Pending rows).
export function toSyncRows(
  txs: EbTransaction[],
  aspspName: string,
): {
  rows: NormalizedRow[];
  pendingCount: number;
  pendingTotal: number;
} {
  const rows: NormalizedRow[] = [];
  let pendingCount = 0;
  let pendingTotal = 0;
  for (const t of txs) {
    const amount = signed(t);
    if (!Number.isFinite(amount)) continue;
    if (t.status === "PDNG") {
      pendingCount++;
      pendingTotal += amount;
      continue;
    }
    if (t.status !== "BOOK") continue;
    const day = t.booking_date ?? t.value_date;
    if (!isValidIsoDay(day)) continue;
    const label = normalizeBankLabel((t.remittance_information ?? []).join("\n"), aspspName);
    rows.push({ date: dayStart(day), amount: round2(amount), rawLabel: label || EMPTY_LABEL });
  }
  return { rows, pendingCount, pendingTotal: round2(pendingTotal) };
}

// From max(syncFrom, lastSyncedDate − overlap), never before the bank's ~3-year history.
export function syncWindowStart(
  a: { syncFrom: Date | null; lastSyncedDate: Date | null },
  now: Date,
): string {
  const floor = new Date(now);
  floor.setUTCFullYear(floor.getUTCFullYear() - FIRST_FETCH_YEARS);
  const starts = [floor.getTime()];
  if (a.syncFrom) starts.push(a.syncFrom.getTime());
  if (a.lastSyncedDate) starts.push(a.lastSyncedDate.getTime() - SYNC_OVERLAP_DAYS * DAY_MS);
  return toIsoDay(new Date(Math.max(...starts)));
}

type DatedAmount = { amount: number; date: Date };

function latest(balances: EbBalance[], type: string, today: Date): DatedAmount | null {
  let best: DatedAmount | null = null;
  for (const b of balances) {
    if (b.balance_type !== type) continue;
    const amount = Number(b.balance_amount.amount);
    if (!Number.isFinite(amount)) continue;
    const date = isValidIsoDay(b.reference_date) ? dayStart(b.reference_date) : today;
    if (!best || date > best.date) best = { amount: round2(amount), date };
  }
  return best;
}

export function pickBalances(
  balances: EbBalance[],
  now: Date,
): { booked: DatedAmount | null; expected: DatedAmount | null } {
  const today = dayStart(toIsoDay(now));
  return { booked: latest(balances, "CLBD", today), expected: latest(balances, "XPCD", today) };
}
