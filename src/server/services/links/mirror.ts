import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { decrypt } from "@/server/crypto/encryption";
import { dataKey } from "@/server/crypto/keys";
import { logEvent } from "@/server/services/audit";
import { matchRule } from "@/server/services/categorization/match";
import { AUTO_LINK_WINDOW_DAYS, pairKeyOf } from "@/lib/links";
import { toMirrorMatchType, type MirrorMatchType } from "@/lib/validation/account";
import { alignNewLinkMonth, type MonthLeg } from "./month";
import { createLinkedTransferLeg } from "./leg";

const DAY_MS = 86_400_000;
export const MIRROR_PREFIX = "mirror:";

// Derived from the source row's dedup key, so a re-import of the same row maps to the same leg
// and a deleted leg's tombstone keeps it deleted.
export function mirrorExternalId(source: { accountId: string; externalId: string }): string {
  const hash = createHash("sha256")
    .update(`${source.accountId}|${source.externalId}`)
    .digest("hex");
  return MIRROR_PREFIX + hash;
}

export const isMirrorExternalId = (externalId: string | null): boolean =>
  !!externalId?.startsWith(MIRROR_PREFIX);

type Savings = { id: string; ownerId: string; pattern: string; matchType: MirrorMatchType };
type SourceRow = MonthLeg & { accountId: string; amount: number; externalId: string };

const squashSpaces = (s: string) => s.replace(/\s+/g, " ");

// EXACT compares the whole label, whitespace runs collapsed (bank labels pad with spaces).
export function mirrorMatches(
  { pattern, matchType }: Pick<Savings, "pattern" | "matchType">,
  label: string,
): boolean {
  const exact = matchType === "EXACT";
  return matchRule(
    {
      id: "",
      categoryId: "",
      pattern: exact ? squashSpaces(pattern) : pattern,
      matchType,
      caseSensitive: false,
    },
    exact ? squashSpaces(label) : label,
  );
}

// An exact match beats a contains one, then the longest pattern wins.
const compareTargets = (a: Savings, b: Savings) =>
  Number(b.matchType === "EXACT") - Number(a.matchType === "EXACT") ||
  b.pattern.length - a.pattern.length ||
  (a.id < b.id ? -1 : 1);

// Opposite legs on the savings accounts the batch's source rows feed (design §Savings mirror
// legs). Runs after auto-links: only TRANSFER rows they left unlinked are considered.
export async function mirrorSavingsLegs(
  batchId: string,
): Promise<{ created: number; linked: number }> {
  const batchAccounts = await db.transaction.findMany({
    where: { importBatchId: batchId },
    select: { accountId: true },
    distinct: ["accountId"],
  });
  const configs = await db.savingsMirrorSource.findMany({
    where: {
      sourceAccountId: { in: batchAccounts.map((a) => a.accountId) },
      savings: { type: "SAVINGS", archived: false, mirrorPattern: { not: null } },
    },
    select: {
      sourceAccountId: true,
      source: { select: { name: true, ownerId: true } },
      savings: { select: { id: true, ownerId: true, mirrorPattern: true, mirrorMatchType: true } },
    },
  });
  const savingsOf = new Map<string, Savings[]>();
  const sourceName = new Map<string, string>();
  for (const c of configs) {
    // Mirror legs stay within one owner's accounts (design §Ownership).
    if (c.savings.ownerId !== c.source.ownerId) continue;
    const list = savingsOf.get(c.sourceAccountId) ?? [];
    list.push({
      id: c.savings.id,
      ownerId: c.savings.ownerId,
      pattern: c.savings.mirrorPattern!,
      matchType: toMirrorMatchType(c.savings.mirrorMatchType),
    });
    savingsOf.set(c.sourceAccountId, list);
    sourceName.set(c.sourceAccountId, c.source.name);
  }
  if (savingsOf.size === 0) return { created: 0, linked: 0 };

  const rows = await db.transaction.findMany({
    where: {
      importBatchId: batchId,
      accountId: { in: [...savingsOf.keys()] },
      type: "TRANSFER",
      linkMembership: { is: null },
      externalId: { not: null },
    },
    select: {
      id: true,
      accountId: true,
      amount: true,
      date: true,
      type: true,
      periodDate: true,
      periodManual: true,
      externalId: true,
      rawLabelEnc: true,
    },
    orderBy: [{ date: "asc" }, { id: "asc" }],
  });

  const perOwner = new Map<string, { created: number; linked: number }>();
  for (const r of rows) {
    const label = decrypt(r.rawLabelEnc, dataKey);
    const target = savingsOf
      .get(r.accountId)!
      .filter((s) => mirrorMatches(s, label))
      .sort(compareTargets)[0];
    if (!target) continue;
    const source: SourceRow = { ...r, amount: Number(r.amount), externalId: r.externalId! };
    const outcome = await mirrorOne(source, target, sourceName.get(r.accountId)!);
    if (outcome === "skipped") continue;
    const counts = perOwner.get(target.ownerId) ?? { created: 0, linked: 0 };
    counts[outcome]++;
    perOwner.set(target.ownerId, counts);
  }
  const total = { created: 0, linked: 0 };
  for (const [userId, counts] of perOwner) {
    total.created += counts.created;
    total.linked += counts.linked;
    await logEvent({
      userId,
      action: "link.mirrorCreated",
      entity: "ImportBatch",
      entityId: batchId,
      metadata: { count: counts.created, linked: counts.linked },
    });
  }
  return total;
}

// A concurrent run may take the chosen row or create the leg first: retried on P2002.
async function mirrorOne(
  source: SourceRow,
  savings: Savings,
  sourceName: string,
): Promise<"created" | "linked" | "skipped"> {
  const externalId = mirrorExternalId(source);
  for (let attempt = 0; attempt < 3; attempt++) {
    const [sourceLinked, tombstone, legExists] = await Promise.all([
      db.transactionLinkMember.findUnique({
        where: { transactionId: source.id },
        select: { linkId: true },
      }),
      db.syncTombstone.findUnique({
        where: { accountId_externalId: { accountId: savings.id, externalId } },
        select: { accountId: true },
      }),
      db.transaction.findUnique({
        where: { accountId_externalId: { accountId: savings.id, externalId } },
        select: { id: true, linkMembership: { select: { linkId: true } } },
      }),
    ]);
    if (sourceLinked || tombstone || legExists?.linkMembership) return "skipped";
    try {
      const existing = await openCounterpart(source, savings);
      if (existing) {
        await linkPair(source, existing, savings.ownerId);
        return "linked";
      }
      if (legExists) return "skipped";
      const leg = await createLinkedTransferLeg({
        source,
        accountId: savings.id,
        sourceName,
        actorId: savings.ownerId,
        auto: true,
        externalId,
      });
      await alignNewLinkMonth([source, leg]);
      return "created";
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue;
      throw e;
    }
  }
  return "skipped";
}

// An unlinked row of the opposite amount within the auto-link window: the closest date, then
// the earliest entered. Pairs the owner dismissed as suggestions are left alone.
async function openCounterpart(source: SourceRow, savings: Savings): Promise<MonthLeg | null> {
  const window = AUTO_LINK_WINDOW_DAYS * DAY_MS;
  const candidates = await db.transaction.findMany({
    where: {
      accountId: savings.id,
      amount: -source.amount,
      date: {
        gte: new Date(source.date.getTime() - window),
        lte: new Date(source.date.getTime() + window),
      },
      linkMembership: { is: null },
    },
    select: {
      id: true,
      date: true,
      type: true,
      periodDate: true,
      periodManual: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (candidates.length === 0) return null;
  const ignored = new Set(
    (
      await db.ignoredLinkSuggestion.findMany({
        where: {
          userId: savings.ownerId,
          pairKey: { in: candidates.map((c) => pairKeyOf(c.id, source.id)) },
        },
        select: { pairKey: true },
      })
    ).map((i) => i.pairKey),
  );
  const delta = (d: Date) => Math.abs(d.getTime() - source.date.getTime());
  let best: (typeof candidates)[number] | null = null;
  for (const c of candidates) {
    if (ignored.has(pairKeyOf(c.id, source.id))) continue;
    if (!best || delta(c.date) < delta(best.date)) best = c;
  }
  return best;
}

async function linkPair(source: MonthLeg, other: MonthLeg, ownerId: string): Promise<void> {
  await db.transactionLink.create({
    data: {
      auto: true,
      createdById: ownerId,
      members: { create: [{ transactionId: source.id }, { transactionId: other.id }] },
    },
  });
  await alignNewLinkMonth([source, other]);
}
