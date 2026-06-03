import { PrismaClient } from "@prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { seedRolesAndPermissions, seedAppSettings } from "../prisma/seed";
import { getAuth } from "@/server/auth";
import { seedDefaultCategories } from "@/server/services/categories/seed-defaults";
import { createTransaction } from "@/server/services/transactions";
import type { TransactionInput } from "@/lib/validation/transaction";
import type { CategoryNode } from "@/server/services/categories";
import { listForUser } from "@/server/services/categories";

// Dev convenience: (re)creates a personal credentialed user with fake data to
// click around locally after a `db:reset`. Idempotent: skips signup if the user
// already exists. Run with: tsx scripts/seed-dev-user.ts
const EMAIL = "nathanjaunet44@gmail.com";
const PASSWORD = EMAIL; // per request: password = email
const NAME = "Nathan Jaunet";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required to seed the dev user");
const db = new PrismaClient({ adapter: new PrismaMariaDb(url) });

function flatten(tree: CategoryNode[]): { id: string; name: string }[] {
  const out: { id: string; name: string }[] = [];
  for (const node of tree) {
    out.push({ id: node.id, name: node.name });
    if (node.children?.length) out.push(...flatten(node.children));
  }
  return out;
}

async function main(): Promise<void> {
  await seedRolesAndPermissions(db);
  await seedAppSettings(db);
  await db.appSetting.upsert({
    where: { key: "registration_mode" },
    update: { value: "OPEN" as never },
    create: { key: "registration_mode", value: "OPEN" as never },
  });

  const auth = await getAuth();
  let user = await db.user.findUnique({ where: { email: EMAIL } });
  if (!user) {
    const res = await auth.api.signUpEmail({
      body: { email: EMAIL, password: PASSWORD, name: NAME },
    });
    user = await db.user.findUniqueOrThrow({ where: { id: res.user.id } });
  }
  const userId = user.id;
  await seedDefaultCategories(userId, "fr", db);

  // Two accounts.
  const courant = await db.bankAccount.upsert({
    where: { id: "dev-nathan-courant" },
    update: {},
    create: {
      id: "dev-nathan-courant",
      ownerId: userId,
      name: "Compte courant",
      type: "CHECKING",
      bankName: "Boursorama",
      color: "#2563eb",
      initialBalance: 1500,
    },
  });
  const livret = await db.bankAccount.upsert({
    where: { id: "dev-nathan-livret" },
    update: {},
    create: {
      id: "dev-nathan-livret",
      ownerId: userId,
      name: "Livret A",
      type: "SAVINGS",
      bankName: "Boursorama",
      color: "#16a34a",
      initialBalance: 8200,
    },
  });

  // Map a few default category names to ids for realistic assignment.
  const cats = flatten(await listForUser(userId));
  const byName = (name: string) =>
    cats.find((c) => c.name.toLowerCase() === name.toLowerCase())?.id;

  type Seed = {
    account: string;
    daysAgo: number;
    amount: number;
    label: string;
    type: TransactionInput["type"];
    category?: string;
  };
  const seeds: Seed[] = [
    {
      account: courant.id,
      daysAgo: 1,
      amount: -42.9,
      label: "CB CARREFOUR CITY",
      type: "CARD",
      category: "Courses",
    },
    {
      account: courant.id,
      daysAgo: 2,
      amount: -12.5,
      label: "CB BOULANGERIE PAUL",
      type: "CARD",
      category: "Restaurants",
    },
    {
      account: courant.id,
      daysAgo: 3,
      amount: -59.99,
      label: "PRLV SFR MOBILE",
      type: "DIRECT_DEBIT",
      category: "Téléphone",
    },
    {
      account: courant.id,
      daysAgo: 4,
      amount: -742,
      label: "VIR LOYER APPARTEMENT",
      type: "TRANSFER",
      category: "Loyer",
    },
    {
      account: courant.id,
      daysAgo: 5,
      amount: -28.4,
      label: "CB TOTAL ENERGIES",
      type: "CARD",
      category: "Carburant",
    },
    {
      account: courant.id,
      daysAgo: 6,
      amount: -9.99,
      label: "PRLV NETFLIX",
      type: "DIRECT_DEBIT",
      category: "Loisirs",
    },
    {
      account: courant.id,
      daysAgo: 7,
      amount: -73.2,
      label: "CB LECLERC DRIVE",
      type: "CARD",
      category: "Courses",
    },
    { account: courant.id, daysAgo: 9, amount: -15, label: "RETRAIT DAB", type: "ATM" },
    {
      account: courant.id,
      daysAgo: 12,
      amount: 2450,
      label: "VIR SEPA SALAIRE",
      type: "TRANSFER",
      category: "Salaire",
    },
    {
      account: courant.id,
      daysAgo: 15,
      amount: -34.8,
      label: "CB AMAZON",
      type: "CARD",
      category: "Shopping",
    },
    {
      account: courant.id,
      daysAgo: 18,
      amount: -22,
      label: "CB UBER EATS",
      type: "CARD",
      category: "Restaurants",
    },
    {
      account: courant.id,
      daysAgo: 22,
      amount: -120,
      label: "CB PHARMACIE",
      type: "CARD",
      category: "Santé",
    },
    {
      account: livret.id,
      daysAgo: 10,
      amount: 200,
      label: "VIR EPARGNE MENSUELLE",
      type: "TRANSFER",
      category: "Épargne",
    },
    { account: livret.id, daysAgo: 40, amount: 18.45, label: "INTERETS LIVRET A", type: "OTHER" },
  ];

  for (const s of seeds) {
    const date = new Date(Date.now() - s.daysAgo * 86_400_000);
    date.setUTCHours(0, 0, 0, 0);
    await createTransaction(
      {
        accountId: s.account,
        date,
        amount: s.amount,
        type: s.type,
        label: s.label,
        categoryId: s.category ? byName(s.category) : undefined,
      },
      { id: userId },
    );
  }

  console.log(
    `Seeded ${EMAIL} (password = email) with 2 accounts and ${seeds.length} transactions.`,
  );
}

main()
  .then(async () => {
    await db.$disconnect();
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
