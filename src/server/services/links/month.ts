import { db } from "@/server/db";
import { canWriteAccount } from "@/server/services/accounts/sharing";
import { manualPeriodDate, type YearMonth } from "@/lib/assigned-month";

export type MonthLeg = {
  id: string;
  type: string;
  date: Date;
  periodDate: Date;
  periodManual: boolean;
};

export async function setManualMonth(
  rows: { id: string; date: Date }[],
  month: YearMonth,
): Promise<void> {
  await db.$transaction(
    rows.map((r) =>
      db.transaction.update({
        where: { id: r.id },
        data: { periodDate: manualPeriodDate(r.date, month.year, month.month), periodManual: true },
      }),
    ),
  );
}

// The other members of `id`'s link that follow its month (#358): only in a link of transfers,
// and only those the actor can write.
export async function linkedTransferLegs(
  id: string,
  actorId: string,
): Promise<{ id: string; date: Date }[]> {
  const membership = await db.transactionLinkMember.findUnique({
    where: { transactionId: id },
    select: {
      link: {
        select: {
          members: {
            select: {
              transaction: { select: { id: true, accountId: true, type: true, date: true } },
            },
          },
        },
      },
    },
  });
  if (!membership) return [];
  const legs = membership.link.members.map((m) => m.transaction);
  if (legs.some((t) => t.type !== "TRANSFER")) return [];
  const out: { id: string; date: Date }[] = [];
  for (const t of legs) {
    if (t.id !== id && (await canWriteAccount(actorId, t.accountId))) out.push(t);
  }
  return out;
}

// On a new link of transfers where exactly one leg has a manual month, the others take it (#358).
export async function alignNewLinkMonth(legs: MonthLeg[]): Promise<void> {
  if (legs.some((l) => l.type !== "TRANSFER")) return;
  const manual = legs.filter((l) => l.periodManual);
  if (manual.length !== 1) return;
  const { periodDate } = manual[0];
  await setManualMonth(
    legs.filter((l) => !l.periodManual),
    { year: periodDate.getUTCFullYear(), month: periodDate.getUTCMonth() + 1 },
  );
}
