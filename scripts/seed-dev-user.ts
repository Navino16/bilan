import { PrismaClient } from "@prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { seedRolesAndPermissions, seedAppSettings } from "../prisma/seed";
import { getAuth } from "@/server/auth";
import { seedDefaultCategories } from "@/server/services/categories/seed-defaults";
import { listForUser, type CategoryNode } from "@/server/services/categories";
import { createTransaction } from "@/server/services/transactions";
import { createRule } from "@/server/services/categorization";
import { createBudget, rollRecurring } from "@/server/services/budgets";
import { createGroup } from "@/server/services/groups";
import { shareAccountWithGroup } from "@/server/services/accounts/sharing";
import { createLink } from "@/server/services/links";
import { deleteUser } from "@/server/services/rgpd";
import { grantRole } from "@/server/services/users/roles";
import type { TransactionType } from "@/lib/validation/transaction";

// Dev convenience: a SUPER_ADMIN user with ~12 months of realistic data ending
// today (accounts, categorized history, rules, budgets, a shared household,
// links). Deterministic for a given day. Usage: npm run db:seed-dev [-- --reset]
const EMAIL = "dev@bilan.local";
const PASSWORD = "dev-password-123";
const NAME = "Camille Martin";
const MEMBER_EMAIL = "member@e2e.local";
const MONTHS = 12;

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required to seed the dev user");
const db = new PrismaClient({ adapter: new PrismaMariaDb(url) });

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260928);
const chance = (p: number) => rand() < p;
const int = (min: number, max: number) => Math.floor(min + rand() * (max - min + 1));
const amount = (min: number, max: number) => Math.round((min + rand() * (max - min)) * 100) / 100;
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];

function flatten(tree: CategoryNode[]): { id: string; name: string }[] {
  return tree.flatMap((n) => [{ id: n.id, name: n.name }, ...flatten(n.children)]);
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

type Tx = {
  account: "courant" | "livret" | "joint";
  date: Date;
  amount: number;
  label: string;
  type: TransactionType;
  category?: string;
  pairKey?: string; // rows sharing a key become one link
};

function monthTransactions(y: number, m0: number): Tx[] {
  const last = new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
  const day = (d: number) => new Date(Date.UTC(y, m0, Math.min(d, last)));
  const anyDay = () => day(int(1, last));
  const out: Tx[] = [];
  const add = (tx: Omit<Tx, "date"> & { date?: Date }) => out.push({ date: anyDay(), ...tx });
  const key = `${y}-${m0}`;

  // Fixed monthly flows.
  add({
    account: "courant",
    date: day(28),
    amount: 2650,
    label: "VIR SEPA SALAIRE ACME SAS",
    type: "TRANSFER",
    category: "Salaire",
  });
  if (m0 === 11)
    add({
      account: "courant",
      date: day(20),
      amount: 800,
      label: "VIR SEPA PRIME ANNUELLE ACME",
      type: "TRANSFER",
      category: "Salaire",
    });
  add({
    account: "courant",
    date: day(2),
    amount: -950,
    label: "VIR COMPTE JOINT",
    type: "TRANSFER",
    pairKey: `joint-${key}`,
  });
  add({
    account: "joint",
    date: day(2),
    amount: 950,
    label: "VIR DE MME CAMILLE MARTIN",
    type: "TRANSFER",
    pairKey: `joint-${key}`,
  });
  add({
    account: "courant",
    date: day(29),
    amount: -200,
    label: "VIR LIVRET A",
    type: "TRANSFER",
    pairKey: `livret-${key}`,
  });
  add({
    account: "livret",
    date: day(29),
    amount: 200,
    label: "VIR DEPUIS COMPTE COURANT",
    type: "TRANSFER",
    pairKey: `livret-${key}`,
  });
  add({
    account: "joint",
    date: day(5),
    amount: -890,
    label: "PRLV FONCIA LOYER",
    type: "DIRECT_DEBIT",
    category: "Loyer & prêt",
  });
  const winter = [0, 1, 2, 10, 11].includes(m0);
  add({
    account: "joint",
    date: day(10),
    amount: -amount(winter ? 85 : 50, winter ? 120 : 70),
    label: "PRLV EDF CLIENTS PARTICULIERS",
    type: "DIRECT_DEBIT",
    category: "Électricité & gaz",
  });
  add({
    account: "joint",
    date: day(12),
    amount: -34.99,
    label: "PRLV SFR BOX",
    type: "DIRECT_DEBIT",
    category: "Internet & téléphone",
  });
  add({
    account: "joint",
    date: day(15),
    amount: -18.5,
    label: "PRLV MAIF HABITATION",
    type: "DIRECT_DEBIT",
    category: "Charges",
  });
  add({
    account: "courant",
    date: day(18),
    amount: -15.99,
    label: "PRLV FREE MOBILE",
    type: "DIRECT_DEBIT",
    category: "Internet & téléphone",
  });
  add({
    account: "courant",
    date: day(3),
    amount: -42,
    label: "PRLV HARMONIE MUTUELLE",
    type: "DIRECT_DEBIT",
    category: "Mutuelle",
  });
  add({
    account: "courant",
    date: day(8),
    amount: -13.49,
    label: "CB NETFLIX.COM",
    type: "CARD",
    category: "Abonnements",
  });
  add({
    account: "courant",
    date: day(20),
    amount: -11.12,
    label: "CB SPOTIFY",
    type: "CARD",
    category: "Abonnements",
  });
  if (m0 !== 7)
    add({
      account: "courant",
      date: day(1),
      amount: -86.4,
      label: "CB NAVIGO MOIS",
      type: "CARD",
      category: "Transports en commun",
    });
  if (m0 === 11)
    add({
      account: "livret",
      date: day(31),
      amount: amount(95, 115),
      label: "INTERETS LIVRET A",
      type: "OTHER",
      category: "Autres revenus",
    });

  // Variable spending.
  for (let i = int(6, 9); i > 0; i--)
    add({
      account: "joint",
      amount: -amount(18, 140),
      label: pick([
        "CB CARREFOUR MARKET",
        "CB LECLERC DRIVE",
        "CB MONOPRIX",
        "CB LIDL",
        "CB PICARD",
      ]),
      type: "CARD",
      category: "Courses",
    });
  for (let i = int(2, 5); i > 0; i--)
    add({
      account: "courant",
      amount: -amount(14, 65),
      label: pick(["CB BISTROT DU COIN", "CB SUSHI SHOP", "CB UBER EATS", "CB PIZZERIA NAPOLI"]),
      type: "CARD",
      category: "Restaurants",
    });
  for (let i = int(3, 7); i > 0; i--)
    add({
      account: "courant",
      amount: -amount(2.5, 6.5),
      label: pick(["CB STARBUCKS", "CB BOULANGERIE PAUL", "CB COLUMBUS CAFE"]),
      type: "CARD",
      category: "Café & snacks",
    });
  for (let i = int(1, 2); i > 0; i--)
    add({
      account: "joint",
      amount: -amount(45, 80),
      label: pick(["CB TOTAL ENERGIES", "CB ESSO EXPRESS"]),
      type: "CARD",
      category: "Carburant",
    });
  for (let i = int(1, 3); i > 0; i--)
    add({
      account: "courant",
      amount: -amount(10, 55),
      label: pick(["CB UGC CINE CITE", "CB LE COMPTOIR BAR", "CB FNAC SPECTACLES"]),
      type: "CARD",
      category: "Sorties",
    });
  if (chance(0.5))
    add({
      account: "courant",
      amount: -amount(6, 35),
      label: "CB PHARMACIE DU CENTRE",
      type: "CARD",
      category: "Pharmacie",
    });
  if (chance(0.35)) {
    const d = int(1, last - 5);
    add({
      account: "courant",
      date: day(d),
      amount: -30,
      label: "CB DR MARTIN MEDECIN",
      type: "CARD",
      category: "Médecin",
    });
    add({
      account: "courant",
      date: day(d + 4),
      amount: 21,
      label: "REMB CPAM SOINS",
      type: "TRANSFER",
      category: "Remboursements",
    });
  }
  if (chance(0.4))
    add({
      account: "courant",
      amount: -amount(30, 120),
      label: pick(["CB ZARA", "CB UNIQLO", "CB DECATHLON"]),
      type: "CARD",
      category: "Vêtements",
    });
  if (chance(0.3))
    add({
      account: "joint",
      amount: -amount(15, 90),
      label: pick(["CB IKEA", "CB LEROY MERLIN"]),
      type: "CARD",
      category: "Maison",
    });
  if (m0 === 2 || m0 === 9)
    add({
      account: "joint",
      amount: -amount(90, 250),
      label: "CB NORAUTO",
      type: "CARD",
      category: "Entretien véhicule",
    });
  if (m0 === 6) {
    add({
      account: "courant",
      date: day(4),
      amount: -amount(80, 160),
      label: "SNCF CONNECT",
      type: "CARD",
      category: "Voyages",
    });
    add({
      account: "courant",
      date: day(6),
      amount: -amount(350, 600),
      label: "AIRBNB * HMXYZ",
      type: "CARD",
      category: "Voyages",
    });
  }
  if (m0 === 11)
    add({
      account: "courant",
      date: day(19),
      amount: -amount(60, 120),
      label: "SNCF CONNECT",
      type: "CARD",
      category: "Voyages",
    });

  // Left uncategorized on purpose (to exercise suggestions / manual review).
  for (let i = int(1, 2); i > 0; i--)
    add({ account: "courant", amount: -pick([20, 40, 50, 60]), label: "RETRAIT DAB", type: "ATM" });
  if (chance(0.6))
    add({
      account: "courant",
      amount: -amount(8, 45),
      label: pick(["PAYPAL *VINTED", "CB AMAZON MKTPLACE", "VIR M DUPONT REMBOURSEMENT"]),
      type: pick(["CARD", "TRANSFER"] as const),
    });
  return out;
}

async function resetUser(userId: string): Promise<void> {
  // deleteUser hands owned groups to another member; the dev household must go.
  await db.group.deleteMany({ where: { createdById: userId } });
  await deleteUser(userId);
}

async function main(): Promise<void> {
  await seedRolesAndPermissions(db);
  await seedAppSettings(db);

  const existing = await db.user.findUnique({ where: { email: EMAIL } });
  if (existing) {
    if (!process.argv.includes("--reset")) {
      console.error(`${EMAIL} already exists. Re-run with --reset to wipe and re-seed it.`);
      process.exit(1);
    }
    await resetUser(existing.id);
  }

  const auth = await getAuth();
  const res = await auth.api.signUpEmail({
    body: { email: EMAIL, password: PASSWORD, name: NAME },
  });
  const userId = res.user.id;
  const actor = { id: userId };
  await db.user.update({ where: { id: userId }, data: { emailVerified: true } });
  await grantRole(db, userId, "SUPER_ADMIN", userId);
  await seedDefaultCategories(userId, "fr", db);

  const accountIds = {
    courant: (
      await db.bankAccount.create({
        data: {
          ownerId: userId,
          name: "Compte courant",
          type: "CHECKING",
          bankName: "Boursorama",
          color: "#2563eb",
          initialBalance: 1200,
        },
      })
    ).id,
    livret: (
      await db.bankAccount.create({
        data: {
          ownerId: userId,
          name: "Livret A",
          type: "SAVINGS",
          bankName: "Boursorama",
          color: "#16a34a",
          initialBalance: 6000,
        },
      })
    ).id,
    joint: (
      await db.bankAccount.create({
        data: {
          ownerId: userId,
          name: "Compte joint",
          type: "CHECKING",
          bankName: "Crédit Agricole",
          color: "#d97706",
          initialBalance: 800,
        },
      })
    ).id,
  };

  const cats = flatten(await listForUser(userId));
  const catId = (name: string) => {
    const id = cats.find((c) => c.name === name)?.id;
    if (!id) throw new Error(`Unknown default category: ${name}`);
    return id;
  };

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const txs: Tx[] = [];
  for (let back = MONTHS - 1; back >= 0; back--) {
    const ref = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - back, 1));
    txs.push(...monthTransactions(ref.getUTCFullYear(), ref.getUTCMonth()));
  }
  // A balanced purchase + refund pair, three months back.
  const refundMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 3, 10));
  txs.push(
    {
      account: "courant",
      date: refundMonth,
      amount: -249,
      label: "CB DARTY",
      type: "CARD",
      category: "High-tech",
      pairKey: "darty",
    },
    {
      account: "courant",
      date: new Date(refundMonth.getTime() + 6 * 86_400_000),
      amount: 249,
      label: "REMB DARTY RETOUR",
      type: "TRANSFER",
      category: "High-tech",
      pairKey: "darty",
    },
  );

  const pairs = new Map<string, string[]>();
  let created = 0;
  for (const tx of txs.filter((t) => t.date <= today).sort((a, b) => +a.date - +b.date)) {
    const { id } = await createTransaction(
      {
        accountId: accountIds[tx.account],
        date: tx.date,
        amount: tx.amount,
        type: tx.type,
        label: tx.label,
        categoryId: tx.category ? catId(tx.category) : undefined,
      },
      actor,
    );
    created++;
    if (tx.pairKey) pairs.set(tx.pairKey, [...(pairs.get(tx.pairKey) ?? []), id]);
  }
  let links = 0;
  for (const [pairKey, ids] of pairs) {
    if (ids.length < 2) continue;
    await createLink({
      transactionIds: ids,
      userId,
      name: pairKey === "darty" ? "Retour Darty" : null,
    });
    links++;
  }

  for (const [pattern, category] of [
    ["CARREFOUR", "Courses"],
    ["NETFLIX", "Abonnements"],
    ["SNCF", "Voyages"],
  ] as const) {
    const { id } = await createRule(
      { pattern, matchType: "CONTAINS", categoryId: catId(category) },
      actor,
    );
    // History is seeded already categorized, so credit each rule with what it would have matched.
    const hits = txs.filter((t) => t.date <= today && t.label.includes(pattern)).length;
    await db.categorizationRule.update({ where: { id }, data: { hits } });
  }

  const { id: groupId } = await createGroup(
    { name: "Foyer Martin", description: "Compte joint et charges du logement" },
    userId,
  );
  await shareAccountWithGroup({ accountId: accountIds.joint, groupId, permission: "WRITE" }, actor);
  const member = await db.user.findUnique({ where: { email: MEMBER_EMAIL } });
  if (member) await db.groupMember.create({ data: { groupId, userId: member.id, role: "MEMBER" } });

  // Last month's recurring budget, rolled into this month.
  const monthBounds = (offset: number) => ({
    start: isoDay(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + offset, 1))),
    end: isoDay(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + offset + 1, 0))),
  });
  const prev = monthBounds(-1);
  const { id: template } = await createBudget(
    {
      name: "Budget mensuel",
      periodType: "MONTH",
      periodStart: prev.start,
      periodEnd: prev.end,
      recurring: true,
      lines: [
        { categoryId: catId("Restaurants"), plannedAmount: 120 },
        { categoryId: catId("Café & snacks"), plannedAmount: 25 },
        { categoryId: catId("Sorties"), plannedAmount: 80 },
        { categoryId: catId("Abonnements"), plannedAmount: 30 },
      ],
    },
    actor,
  );
  await rollRecurring(template, actor);
  const cur = monthBounds(0);
  await createBudget(
    {
      name: "Charges du foyer",
      groupId,
      periodType: "MONTH",
      periodStart: cur.start,
      periodEnd: cur.end,
      lines: [
        { categoryId: catId("Loyer & prêt"), plannedAmount: 890 },
        { categoryId: catId("Électricité & gaz"), plannedAmount: 80 },
        { categoryId: catId("Courses"), plannedAmount: 550 },
      ],
    },
    actor,
  );

  console.log(
    `Seeded ${EMAIL} (password ${PASSWORD}): 3 accounts, ${created} transactions over ${MONTHS} months, ` +
      `${links} links, 3 rules, household "Foyer Martin"${member ? ` (+ ${MEMBER_EMAIL})` : ""}, 3 budgets.`,
  );
}

main()
  .then(async () => {
    await db.$disconnect();
    process.exit(0);
  })
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
