import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { decrypt } from "@/server/crypto/encryption";
import { dataKey } from "@/server/crypto/keys";
import { logEvent } from "@/server/services/audit";
import { AUTO_LINK_WINDOW_DAYS, findAutoLinkPairs, labelWords } from "@/lib/links";
import { merchantKey } from "@/lib/merchant";

const DAY_MS = 86_400_000;

// Links the legs of transfers between accounts `ownerId` owns (spec A). With a range, only
// rows dated within it (± the matching window) are considered, as after an import.
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
  if (opts.from) date.gte = new Date(opts.from.getTime() - margin);
  if (opts.to) date.lte = new Date(opts.to.getTime() + margin);
  const [candidates, ignoredRows] = await Promise.all([
    db.transaction.findMany({
      where: {
        accountId: { in: accounts.map((a) => a.id) },
        linkMembership: { is: null },
        ...(opts.from || opts.to ? { date } : {}),
      },
      select: {
        id: true,
        accountId: true,
        amount: true,
        date: true,
        type: true,
        merchantKeyHash: true,
        labelEnc: true,
      },
    }),
    db.ignoredLinkSuggestion.findMany({ where: { userId: ownerId }, select: { pairKey: true } }),
  ]);

  // Only rows with an opposite amount among the candidates can pair: decrypt just those.
  const cents = (n: number) => Math.round(n * 100);
  const signed = new Set(candidates.map((t) => cents(Number(t.amount))));
  const rows = candidates.map((t) => {
    const amount = Number(t.amount);
    return {
      id: t.id,
      accountId: t.accountId,
      amount,
      date: t.date,
      type: t.type,
      merchantKeyHash: t.merchantKeyHash,
      words: signed.has(-cents(amount))
        ? labelWords(merchantKey(decrypt(t.labelEnc, dataKey)))
        : undefined,
    };
  });
  const pairs = findAutoLinkPairs(rows, {
    windowDays: AUTO_LINK_WINDOW_DAYS,
    ignored: new Set(ignoredRows.map((r) => r.pairKey)),
  });

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
      linked++;
    } catch (e) {
      // A leg linked meanwhile (unique transactionId): leave that pair alone.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue;
      throw e;
    }
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
