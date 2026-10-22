import { db } from "@/server/db";
import { decrypt } from "@/server/crypto/encryption";
import { dataKey } from "@/server/crypto/keys";

const DAY_MS = 86_400_000;

const bucketKey = (date: Date, amount: number) =>
  `${date.toISOString().slice(0, 10)}|${amount.toFixed(2)}`;

// Row index → raw label of the existing transaction it probably duplicates: same UTC day
// and amount, no exact key match. Each existing row backs at most one incoming row, in
// file order; rows already claimed by a certain duplicate (`externalIds`) are left out.
export async function findProbableDuplicates(
  accountId: string,
  rows: { date: Date; amount: number }[],
  externalIds: string[],
  certain: Set<string>,
): Promise<Map<number, string>> {
  const candidates = rows.flatMap((_, i) => (certain.has(externalIds[i]) ? [] : [i]));
  if (candidates.length === 0) return new Map();

  let first = Infinity;
  let last = -Infinity;
  for (const i of candidates) {
    const d = Date.parse(rows[i].date.toISOString().slice(0, 10));
    if (d < first) first = d;
    if (d > last) last = d;
  }
  const existing = await db.transaction.findMany({
    where: {
      accountId,
      date: { gte: new Date(first), lt: new Date(last + DAY_MS) },
      amount: { in: [...new Set(candidates.map((i) => rows[i].amount.toFixed(2)))] },
    },
    select: { date: true, amount: true, externalId: true, rawLabelEnc: true },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });

  const claimed = new Set(externalIds);
  const buckets = new Map<string, string[]>();
  for (const e of existing) {
    if (e.externalId && claimed.has(e.externalId)) continue;
    const key = bucketKey(e.date, Number(e.amount));
    const bucket = buckets.get(key);
    if (bucket) bucket.push(e.rawLabelEnc);
    else buckets.set(key, [e.rawLabelEnc]);
  }

  const out = new Map<number, string>();
  for (const i of candidates) {
    const enc = buckets.get(bucketKey(rows[i].date, rows[i].amount))?.shift();
    if (enc !== undefined) out.set(i, decrypt(enc, dataKey));
  }
  return out;
}
