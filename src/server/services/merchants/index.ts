import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { decrypt, encrypt } from "@/server/crypto/encryption";
import { dataKey } from "@/server/crypto/keys";
import { hashMerchantKey } from "@/server/services/transactions/secure-fields";
import { visibleAccountIds } from "@/server/services/accounts";
import { loadRows, type AggRow } from "@/server/services/dashboard";
import { merchantKeySchema, merchantNameSchema } from "@/lib/validation/merchant";
import { merchantKey } from "@/lib/merchant";
import {
  merchantParts,
  mergeMerchantParts,
  type MerchantAliasGroup,
  type MerchantDirectory,
  type MerchantPart,
  type MerchantRow,
} from "@/lib/insights";
import type { Period } from "@/lib/period";

export class MerchantAliasError extends Error {}

type Alias = { id: string; key: string; name: string };

const sameName = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase();

const ALL_TIME: Period = {
  from: new Date(0),
  to: new Date(Date.UTC(9999, 11, 31)),
  year: null,
  month: null,
};

// Only the rows a merchant can come from are decrypted.
export function merchantRowsOf(rows: AggRow[]): MerchantRow[] {
  return rows
    .filter((r) => r.amount < 0 && r.type !== "TRANSFER" && r.labelEnc)
    .map((r) => ({
      amount: r.amount,
      categoryId: r.categoryId,
      date: r.date,
      type: r.type,
      label: decrypt(r.labelEnc!, dataKey),
    }));
}

type SummedPart = {
  hash: string;
  categoryId: string | null;
  total: Prisma.Decimal;
  count: bigint;
  last: Date;
};

// Each merchant's latest row (the first id on a tie) gives its displayed label.
async function latestLabels(
  spending: Prisma.Sql,
  sums: SummedPart[],
): Promise<Map<string, string>> {
  const last = new Map<string, Date>();
  for (const s of sums) {
    const prev = last.get(s.hash);
    if (!prev || s.last > prev) last.set(s.hash, s.last);
  }
  if (last.size === 0) return new Map();
  const pairs = [...last].map(([hash, date]) => Prisma.sql`(${hash}, ${date})`);
  const rows = await db.$queryRaw<{ hash: string; id: string; labelEnc: string }[]>`
    SELECT t.merchantKeyHash AS hash, t.id, t.labelEnc FROM \`Transaction\` t
    WHERE ${spending} AND (t.merchantKeyHash, t.date) IN (${Prisma.join(pairs)})`;
  const first = new Map<string, { id: string; labelEnc: string }>();
  for (const r of rows) {
    const seen = first.get(r.hash);
    if (!seen || r.id < seen.id) first.set(r.hash, r);
  }
  return new Map([...first].map(([hash, r]) => [hash, decrypt(r.labelEnc, dataKey)]));
}

// The whole history, without decrypting it (#296): unlinked rows are summed in SQL by
// merchant key hash and only each merchant's latest label is decrypted. Linked rows (links
// collapse) and rows without a hash take the row-by-row path.
async function allMerchantParts(userId: string): Promise<MerchantPart[]> {
  const accountIds = await visibleAccountIds(userId);
  if (accountIds.length === 0) return [];
  const spending = Prisma.sql`
    t.accountId IN (${Prisma.join(accountIds)}) AND t.amount < 0 AND t.type <> 'TRANSFER'
    AND t.merchantKeyHash IS NOT NULL AND t.merchantKeyHash <> ${hashMerchantKey("")}
    AND NOT EXISTS (SELECT 1 FROM TransactionLinkMember m WHERE m.transactionId = t.id)`;
  const [sums, others] = await Promise.all([
    db.$queryRaw<SummedPart[]>`
      SELECT t.merchantKeyHash AS hash, t.categoryId, SUM(-t.amount) AS total,
             COUNT(*) AS count, MAX(t.date) AS last
      FROM \`Transaction\` t WHERE ${spending}
      GROUP BY t.merchantKeyHash, t.categoryId`,
    loadRows(accountIds, ALL_TIME, {
      withLabels: true,
      where: { OR: [{ linkMembership: { isNot: null } }, { merchantKeyHash: null }] },
    }),
  ]);
  const labels = await latestLabels(spending, sums);
  const summed = sums.map((s) => {
    const label = labels.get(s.hash)!;
    return {
      key: merchantKey(label),
      label,
      date: s.last,
      categoryId: s.categoryId,
      count: Number(s.count),
      total: Number(s.total),
    };
  });
  return [...summed, ...merchantParts(merchantRowsOf(others.rows))];
}

export function aliasMap(groups: MerchantAliasGroup[]): Map<string, string> {
  return new Map(groups.flatMap((g) => g.keys.map((k) => [k, g.name] as const)));
}

async function load(userId: string): Promise<Alias[]> {
  const rows = await db.merchantAlias.findMany({
    where: { userId },
    select: { id: true, keyEnc: true, nameEnc: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    key: decrypt(r.keyEnc, dataKey),
    name: decrypt(r.nameEnc, dataKey),
  }));
}

// Reuses the stored spelling of a name, so "supermarché" joins "Supermarché".
function canonical(name: string, others: Alias[]): string {
  return others.find((a) => sameName(a.name, name))?.name ?? name;
}

async function membersOf(
  userId: string,
  name: string,
): Promise<{ all: Alias[]; members: Alias[] }> {
  const all = await load(userId);
  const members = all.filter((a) => sameName(a.name, name));
  if (members.length === 0) throw new MerchantAliasError("NOT_FOUND");
  return { all, members };
}

export async function loadAliases(userId: string): Promise<Map<string, string>> {
  return new Map((await load(userId)).map((a) => [a.key, a.name]));
}

export async function listAliasGroups(userId: string): Promise<MerchantAliasGroup[]> {
  const groups = new Map<string, MerchantAliasGroup>();
  for (const a of await load(userId)) {
    const id = a.name.toLocaleLowerCase();
    const g = groups.get(id) ?? { name: a.name, keys: [] };
    g.keys.push(a.key);
    groups.set(id, g);
  }
  return [...groups.values()]
    .map((g) => ({ name: g.name, keys: g.keys.sort() }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Every merchant over the whole history, renamed groups apart (they keep all their keys,
// even those without spending).
export async function getMerchantDirectory(userId: string): Promise<MerchantDirectory> {
  const [parts, groups] = await Promise.all([allMerchantParts(userId), listAliasGroups(userId)]);
  const all = mergeMerchantParts(parts, Infinity, aliasMap(groups));
  const spent = new Map(all.filter((m) => m.alias).map((m) => [m.alias, m]));
  const renamed = groups
    .map((g) => ({
      ...(spent.get(g.name) ?? { search: g.keys[0], total: 0, count: 0, categoryId: null }),
      label: g.name,
      alias: g.name,
      keys: g.keys,
    }))
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
  return { renamed, others: all.filter((m) => !m.alias) };
}

// Naming something "Lidl" also pulls in the unrenamed merchant whose bank label is "LIDL".
async function absorbNamesake(
  userId: string,
  name: string,
  aliasedKeys: Set<string>,
): Promise<void> {
  const parsed = merchantKeySchema.safeParse(name);
  if (!parsed.success || aliasedKeys.has(parsed.data)) return;
  const key = parsed.data;
  const keys = new Set((await allMerchantParts(userId)).map((p) => p.key));
  if (!keys.has(key)) return;
  await db.merchantAlias.create({
    data: {
      userId,
      keyHash: hashMerchantKey(key),
      keyEnc: encrypt(key, dataKey),
      nameEnc: encrypt(name, dataKey),
    },
  });
}

export async function renameMerchant(userId: string, key: string, name: string): Promise<void> {
  const k = merchantKeySchema.parse(key);
  const parsed = merchantNameSchema.parse(name);
  const others = (await load(userId)).filter((a) => a.key !== k);
  const final = canonical(parsed, others);
  const keyEnc = encrypt(k, dataKey);
  const nameEnc = encrypt(final, dataKey);
  await db.merchantAlias.upsert({
    where: { userId_keyHash: { userId, keyHash: hashMerchantKey(k) } },
    create: { userId, keyHash: hashMerchantKey(k), keyEnc, nameEnc },
    update: { keyEnc, nameEnc },
  });
  await absorbNamesake(userId, final, new Set([k, ...others.map((a) => a.key)]));
}

export async function renameAliasGroup(userId: string, from: string, to: string): Promise<void> {
  const parsed = merchantNameSchema.parse(to);
  const { all, members } = await membersOf(userId, from);
  const name = canonical(
    parsed,
    all.filter((a) => !members.includes(a)),
  );
  await db.$transaction(
    members.map((m) =>
      db.merchantAlias.update({
        where: { id: m.id, userId },
        data: { nameEnc: encrypt(name, dataKey) },
      }),
    ),
  );
  // A case-only rename must not re-absorb a merchant the user detached from this group.
  if (merchantKeySchema.safeParse(name).data !== merchantKeySchema.safeParse(from).data)
    await absorbNamesake(userId, name, new Set(all.map((a) => a.key)));
}

export async function deleteAliasGroup(userId: string, name: string): Promise<void> {
  const { members } = await membersOf(userId, name);
  await db.merchantAlias.deleteMany({ where: { userId, id: { in: members.map((m) => m.id) } } });
}

export async function removeMerchantAlias(userId: string, key: string): Promise<void> {
  const keyHash = hashMerchantKey(merchantKeySchema.parse(key));
  const { count } = await db.merchantAlias.deleteMany({ where: { userId, keyHash } });
  if (count === 0) throw new MerchantAliasError("NOT_FOUND");
}
