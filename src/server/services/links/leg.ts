import { db } from "@/server/db";
import { buildSecureFields } from "@/server/services/transactions/secure-fields";
import type { MonthLeg } from "./month";

function transferLegLabel(amount: number, sourceName: string): string {
  return amount > 0 ? `Virement depuis ${sourceName}` : `Virement vers ${sourceName}`;
}

// The other leg of `source`'s transfer on `accountId`, created and linked to it atomically: a
// source linked meanwhile fails the link's unique member (P2002) and leaves no leg behind.
export async function createLinkedTransferLeg(input: {
  source: { id: string; date: Date; amount: number };
  accountId: string;
  sourceName: string;
  actorId: string;
  auto: boolean;
  externalId?: string | null;
}): Promise<MonthLeg & { linkId: string }> {
  const amount = -input.source.amount;
  const label = transferLegLabel(amount, input.sourceName);
  const { tokens, ...secure } = buildSecureFields({ label, rawLabel: label });
  return db.$transaction(async (tx) => {
    const leg = await tx.transaction.create({
      data: {
        accountId: input.accountId,
        date: input.source.date,
        amount,
        type: "TRANSFER",
        ...secure,
        externalId: input.externalId ?? null,
        createdById: input.actorId,
      },
      select: { id: true, date: true, type: true, periodDate: true, periodManual: true },
    });
    await tx.transactionSearchToken.createMany({
      data: tokens.map((tokenHash) => ({ transactionId: leg.id, tokenHash })),
    });
    const link = await tx.transactionLink.create({
      data: {
        auto: input.auto,
        createdById: input.actorId,
        members: { create: [{ transactionId: input.source.id }, { transactionId: leg.id }] },
      },
      select: { id: true },
    });
    return { ...leg, linkId: link.id };
  });
}
