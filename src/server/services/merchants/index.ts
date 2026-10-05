import { db } from "@/server/db";
import { decrypt, encrypt } from "@/server/crypto/encryption";
import { hmacForSearch } from "@/server/crypto/hmac";
import { dataKey, searchKey } from "@/server/crypto/keys";
import { merchantKeySchema, merchantNameSchema } from "@/lib/validation/merchant";
import type { MerchantAliasGroup } from "@/lib/insights";

export class MerchantAliasError extends Error {}

type Alias = { id: string; key: string; name: string };

const sameName = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase();
// Prefixed so a one-word merchant's hash can't be matched against transaction search tokens.
const hashKey = (key: string) => hmacForSearch(`merchant:${key}`, searchKey);

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

export async function renameMerchant(userId: string, key: string, name: string): Promise<void> {
  const k = merchantKeySchema.parse(key);
  const parsed = merchantNameSchema.parse(name);
  const others = (await load(userId)).filter((a) => a.key !== k);
  const keyEnc = encrypt(k, dataKey);
  const nameEnc = encrypt(canonical(parsed, others), dataKey);
  await db.merchantAlias.upsert({
    where: { userId_keyHash: { userId, keyHash: hashKey(k) } },
    create: { userId, keyHash: hashKey(k), keyEnc, nameEnc },
    update: { keyEnc, nameEnc },
  });
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
}

export async function deleteAliasGroup(userId: string, name: string): Promise<void> {
  const { members } = await membersOf(userId, name);
  await db.merchantAlias.deleteMany({ where: { userId, id: { in: members.map((m) => m.id) } } });
}

export async function removeMerchantAlias(userId: string, key: string): Promise<void> {
  const keyHash = hashKey(merchantKeySchema.parse(key));
  const { count } = await db.merchantAlias.deleteMany({ where: { userId, keyHash } });
  if (count === 0) throw new MerchantAliasError("NOT_FOUND");
}
