import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { decrypt } from "@/server/crypto/encryption";
import { dataKey } from "@/server/crypto/keys";
import { logEvent } from "@/server/services/audit";
import { alignNewLinkMonth, type MonthLeg } from "./month";
import { AUTO_LINK_WINDOW_DAYS, findAutoLinkPairs, labelWords } from "@/lib/links";
import { merchantKey } from "@/lib/merchant";

const DAY_MS = 86_400_000;

// Links the legs of transfers between accounts `ownerId` owns (spec A). With a range (after an
// import), only pairs within it ± the window are linked; rows twice as far are loaded so each
// leg's competing candidates are all known.
export async function autoLinkTransfers(
  ownerId: string,
  opts: { from?: Date; to?: Date } = {},
): Promise<{ linked: number }> {
  const accounts = await db.bankAccount.findMany({
    where: { ownerId },
    select: { id: true },
  });
  if (accounts.length < 2) return { linked: 0 };

  const margin = AUTO_LINK_WINDOW_DAYS * DAY_MS;
  const date: Prisma.DateTimeFilter = {};
  if (opts.from) date.gte = new Date(opts.from.getTime() - 2 * margin);
  if (opts.to) date.lte = new Date(opts.to.getTime() + 2 * margin);
  const inRange = (d: Date) =>
    (!opts.from || d.getTime() >= opts.from.getTime() - margin) &&
    (!opts.to || d.getTime() <= opts.to.getTime() + margin);
  const [candidates, ignoredRows] = await Promise.all([
    db.transaction.findMany({
      where: {
        accountId: { in: accounts.map((a) => a.id) },
        type: "TRANSFER",
        linkMembership: { is: null },
        ...(opts.from || opts.to ? { date } : {}),
      },
      select: {
        id: true,
        accountId: true,
        amount: true,
        date: true,
        type: true,
        periodDate: true,
        periodManual: true,
        merchantKeyHash: true,
        labelEnc: true,
      },
    }),
    db.ignoredLinkSuggestion.findMany({ where: { userId: ownerId }, select: { pairKey: true } }),
  ]);

  // Only rows with an opposite amount among the candidates can pair: decrypt just those.
  const cents = (n: number) => Math.round(n * 100);
  const signed = new Set(candidates.map((t) => cents(Number(t.amount))));
  let rows = candidates.map((t) => {
    const amount = Number(t.amount);
    return {
      id: t.id,
      accountId: t.accountId,
      amount,
      date: t.date,
      type: t.type,
      periodDate: t.periodDate,
      periodManual: t.periodManual,
      merchantKeyHash: t.merchantKeyHash,
      words: signed.has(-cents(amount))
        ? labelWords(merchantKey(decrypt(t.labelEnc, dataKey)))
        : undefined,
    };
  });
  const ignored = new Set(ignoredRows.map((r) => r.pairKey));
  const rowOf = new Map(rows.map((r) => [r.id, r]));

  // Linking a pair can leave a former tie unique: repeat until nothing new pairs up.
  let linked = 0;
  for (;;) {
    const pairs = findAutoLinkPairs(rows, { windowDays: AUTO_LINK_WINDOW_DAYS, ignored }).filter(
      (p) => inRange(rowOf.get(p.positiveId)!.date) && inRange(rowOf.get(p.negativeId)!.date),
    );
    if (pairs.length === 0) break;
    const taken = new Set(pairs.flatMap((p) => [p.positiveId, p.negativeId]));
    rows = rows.filter((r) => !taken.has(r.id));
    linked += await createAutoLinks(ownerId, pairs, rowOf);
  }
  if (linked > 0) {
    await logEvent({
      userId: ownerId,
      action: "link.autoCreated",
      entity: "TransactionLink",
      entityId: ownerId,
      metadata: { count: linked },
    });
  }
  return { linked };
}

async function createAutoLinks(
  ownerId: string,
  pairs: { positiveId: string; negativeId: string }[],
  rowOf: Map<string, MonthLeg>,
): Promise<number> {
  let linked = 0;
  for (const p of pairs) {
    try {
      await db.transactionLink.create({
        data: {
          auto: true,
          createdById: ownerId,
          members: {
            create: [{ transactionId: p.positiveId }, { transactionId: p.negativeId }],
          },
        },
      });
      await alignNewLinkMonth([rowOf.get(p.positiveId)!, rowOf.get(p.negativeId)!]);
      linked++;
    } catch (e) {
      // A leg linked meanwhile (unique transactionId): leave that pair alone.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue;
      throw e;
    }
  }
  return linked;
}
