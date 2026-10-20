import { PrismaClient, type Prisma } from "@prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { seedRolesAndPermissions, seedAppSettings } from "../../prisma/seed";
import { getAuth } from "@/server/auth";
import { seedDefaultCategories } from "@/server/services/categories/seed-defaults";
import { listForUser, type CategoryNode } from "@/server/services/categories";
import { createBudget, rollRecurring } from "@/server/services/budgets";
import { createGroup } from "@/server/services/groups";
import { shareAccountWithGroup } from "@/server/services/accounts/sharing";
import { createLink } from "@/server/services/links";
import { renameMerchant } from "@/server/services/merchants";
import { merchantKey } from "@/lib/merchant";
import { grantRole } from "@/server/services/users/roles";
import {
  buildSecureFields,
  computeExternalIds,
} from "@/server/services/transactions/secure-fields";

// Synthetic data set of the performance benchmark (docs/development.md). Usage: tsx scripts/perf/seed-perf.ts <realistic|stress>
// The same profile always yields the same rows, ending at the current month.
const PROFILES = {
  realistic: { scale: 1, target: 30_000, rules: 300, locals: 120, seed: 11 },
  stress: { scale: 5, target: 150_000, rules: 1000, locals: 600, seed: 29 },
} as const;
type ProfileName = keyof typeof PROFILES;
const profileName = process.argv[2] as ProfileName;
const P = PROFILES[profileName];
if (!P) throw new Error("usage: seed-perf.ts <realistic|stress>");
const EMAIL = `${profileName}@perf.local`;
const PARTNER = `${profileName}-partner@perf.local`;
const PASSWORD = "perf-password-123456";
const MONTHS = 72;

const db = new PrismaClient({ adapter: new PrismaMariaDb(process.env.DATABASE_URL!) });

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(P.seed);
const hex = (n: number) =>
  Array.from({ length: n }, () => Math.floor(rand() * 16).toString(16)).join("");
const chance = (p: number) => rand() < p;
const int = (min: number, max: number) => Math.floor(min + rand() * (max - min + 1));
const money = (min: number, max: number) => Math.round((min + rand() * (max - min)) * 100) / 100;
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
const pad = (n: number) => String(n).padStart(2, "0");

type AccountKey = "courant" | "livret" | "joint" | "carte" | "pel";
type Kind = "CARD" | "DIRECT_DEBIT" | "TRANSFER" | "ATM" | "CHEQUE" | "OTHER";
type Merchant = {
  name: string;
  cat: string | null;
  weight: number;
  min: number;
  max: number;
  account: AccountKey;
  kind: Kind;
  local?: boolean;
};

const CITIES = [
  "PARIS 15",
  "PARIS 11",
  "LYON",
  "NANTES",
  "BORDEAUX",
  "LILLE",
  "RENNES",
  "BOULOGNE BILL",
  "MONTREUIL",
  "VINCENNES",
];

// [category, account, kind, min, max, weight, names...]
const CATALOG: [string, AccountKey, Kind, number, number, number, string[]][] = [
  [
    "Courses",
    "joint",
    "CARD",
    12,
    160,
    10,
    [
      "CARREFOUR MARKET",
      "CARREFOUR CITY",
      "LECLERC DRIVE",
      "MONOPRIX",
      "LIDL",
      "PICARD",
      "INTERMARCHE",
      "AUCHAN",
      "FRANPRIX",
      "BIOCOOP",
      "NATURALIA",
      "GRAND FRAIS",
      "CASINO SHOP",
      "U EXPRESS",
      "ALDI MARCHE",
    ],
  ],
  [
    "Restaurants",
    "courant",
    "CARD",
    12,
    85,
    5,
    [
      "BISTROT DU COIN",
      "SUSHI SHOP",
      "UBER EATS",
      "PIZZERIA NAPOLI",
      "DELIVEROO",
      "BURGER KING",
      "MCDONALDS",
      "LE PETIT ZINC",
      "CHEZ GASTON",
      "BIG MAMMA",
      "KFC",
      "PITAYA",
      "BAGELSTEIN",
      "PNY BURGER",
      "COJEAN",
    ],
  ],
  [
    "Café & snacks",
    "courant",
    "CARD",
    2,
    9,
    7,
    [
      "STARBUCKS",
      "BOULANGERIE PAUL",
      "COLUMBUS CAFE",
      "BRIOCHE DOREE",
      "MAISON KAYSER",
      "PRET A MANGER",
      "LA MIE CALINE",
    ],
  ],
  [
    "Carburant",
    "carte",
    "CARD",
    35,
    90,
    2,
    ["TOTAL ENERGIES", "ESSO EXPRESS", "BP STATION", "SHELL", "AVIA", "INTERMARCHE CARBU"],
  ],
  [
    "Transports en commun",
    "courant",
    "CARD",
    1.9,
    25,
    3,
    ["RATP", "SNCF TER", "LIME", "VELIB METROPOLE", "BOLT", "UBER TRIP", "BLABLACAR"],
  ],
  [
    "Sorties",
    "courant",
    "CARD",
    9,
    60,
    2,
    [
      "UGC CINE CITE",
      "PATHE",
      "FNAC SPECTACLES",
      "LE COMPTOIR BAR",
      "BOWLING STAR",
      "MK2",
      "LE PERCHOIR",
    ],
  ],
  [
    "Abonnements",
    "carte",
    "CARD",
    4.99,
    17.99,
    1,
    [
      "DISNEY PLUS",
      "AMAZON PRIME",
      "APPLE.COM/BILL",
      "CANAL+",
      "DEEZER",
      "GOOGLE STORAGE",
      "AUDIBLE",
    ],
  ],
  [
    "Voyages",
    "carte",
    "CARD",
    40,
    650,
    0.6,
    [
      "SNCF CONNECT",
      "AIRBNB * HM",
      "BOOKING.COM",
      "AIR FRANCE",
      "EASYJET",
      "OUIGO",
      "HOTEL IBIS",
      "TRANSAVIA",
    ],
  ],
  [
    "Pharmacie",
    "courant",
    "CARD",
    4,
    40,
    1,
    ["PHARMACIE DU CENTRE", "PHARMACIE DE LA GARE", "PHARMACIE LAFAYETTE"],
  ],
  [
    "Médecin",
    "courant",
    "CARD",
    25,
    80,
    0.6,
    ["DR MARTIN MEDECIN", "CABINET DENTAIRE", "KINE DUPUIS", "OPTIC 2000", "LABO CERBALLIANCE"],
  ],
  [
    "Vêtements",
    "carte",
    "CARD",
    15,
    120,
    1,
    ["ZARA", "UNIQLO", "DECATHLON", "H&M", "KIABI", "CELIO", "JULES", "PROMOD", "VINTED"],
  ],
  [
    "Maison",
    "joint",
    "CARD",
    8,
    220,
    1,
    ["IKEA", "LEROY MERLIN", "CASTORAMA", "MAISONS DU MONDE", "ACTION", "GIFI", "BUT"],
  ],
  [
    "High-tech",
    "carte",
    "CARD",
    15,
    600,
    0.4,
    ["FNAC", "DARTY", "AMAZON MKTPLACE", "LDLC", "APPLE STORE", "BACK MARKET", "BOULANGER"],
  ],
  ["Entretien véhicule", "joint", "CARD", 40, 400, 0.2, ["NORAUTO", "SPEEDY", "FEU VERT", "MIDAS"]],
  ["Animalerie", "joint", "CARD", 10, 70, 0.6, ["MAXI ZOO", "TRUFFAUT ANIMAUX", "ANIMALIS"]],
  ["Vétérinaire", "joint", "CARD", 45, 160, 0.1, ["CLINIQUE VETERINAIRE", "VETO DES LILAS"]],
  [
    "Livres & presse",
    "courant",
    "CARD",
    3,
    35,
    1,
    ["CULTURA", "GIBERT JOSEPH", "RELAY", "LIBRAIRIE MOLLAT", "FNAC LIVRES"],
  ],
  [
    "Jeux vidéo",
    "carte",
    "CARD",
    5,
    70,
    0.4,
    ["STEAM PURCHASE", "PLAYSTATION NETWORK", "NINTENDO ESHOP", "MICROMANIA"],
  ],
  [
    "Coiffeur & beauté",
    "courant",
    "CARD",
    15,
    80,
    0.5,
    ["SEPHORA", "NOCIBE", "SALON DE COIFFURE", "MARIONNAUD"],
  ],
  [
    "Parking & péage",
    "carte",
    "CARD",
    2,
    35,
    1,
    ["INDIGO PARKING", "SAEMES", "VINCI AUTOROUTES", "SANEF", "APRR"],
  ],
  [
    "Sport",
    "courant",
    "CARD",
    10,
    90,
    0.5,
    ["DECATHLON SPORT", "GO SPORT", "INTERSPORT", "CLUB ESCALADE"],
  ],
  [
    "Cadeaux",
    "carte",
    "CARD",
    15,
    120,
    0.4,
    ["NATURE ET DECOUVERTES", "PANDORA", "SMALLABLE", "OXYBUL"],
  ],
  ["Jardin", "joint", "CARD", 10, 90, 0.2, ["JARDILAND", "TRUFFAUT", "GAMM VERT"]],
  ["Tabac", "courant", "CARD", 5, 25, 0.5, ["TABAC DE LA MAIRIE", "TABAC LE MARIGNY"]],
  ["Enfants", "joint", "CARD", 10, 90, 0.6, ["OKAIDI", "VERTBAUDET", "JOUECLUB", "KING JOUET"]],
];

const LOCAL_PREFIXES: [string, string | null][] = [
  ["BOULANGERIE", "Café & snacks"],
  ["BOUCHERIE", "Courses"],
  ["FROMAGERIE", "Courses"],
  ["PRIMEUR", "Courses"],
  ["CAVE", "Courses"],
  ["FLEURISTE", "Cadeaux"],
  ["LIBRAIRIE", "Livres & presse"],
  ["PRESSING", null],
  ["RESTAURANT LE", "Restaurants"],
  ["BAR LE", "Sorties"],
  ["CAFE DE LA", "Café & snacks"],
  ["EPICERIE", "Courses"],
  ["SARL", null],
  ["SAS", null],
];
const LOCAL_NAMES = [
  "MOREAU",
  "LAURENT",
  "SIMON",
  "MICHEL",
  "LEFEVRE",
  "LEROY",
  "ROUX",
  "DAVID",
  "BERTRAND",
  "MOREL",
  "FOURNIER",
  "GIRARD",
  "BONNET",
  "DUPONT",
  "LAMBERT",
  "FONTAINE",
  "ROUSSEAU",
  "VINCENT",
  "MULLER",
  "LEFEVRE",
  "FAURE",
  "ANDRE",
  "MERCIER",
  "BLANC",
  "GUERIN",
  "BOYER",
  "GARNIER",
  "CHEVALIER",
  "FRANCOIS",
  "LEGRAND",
  "GAUTHIER",
  "GARCIA",
  "PERRIN",
  "ROBIN",
  "CLEMENT",
  "MORIN",
  "NICOLAS",
  "HENRY",
  "ROUSSEL",
  "MATHIEU",
  "GAUTIER",
  "MASSON",
  "MARCHAND",
  "DUVAL",
  "DENIS",
  "DUMONT",
  "MARIE",
  "LEMAIRE",
  "NOEL",
  "MEYER",
];
const LOCAL_NOUNS = [
  "SOLEIL",
  "MARCHE",
  "PLACE",
  "GARE",
  "PORT",
  "MOULIN",
  "PONT",
  "JARDIN",
  "CHENE",
  "TILLEUL",
  "MARRONNIER",
  "PARC",
  "QUAI",
  "CANAL",
  "VILLAGE",
  "COIN",
  "LILAS",
  "ROSES",
  "VIGNES",
  "PRES",
];

function buildMerchants(): Merchant[] {
  const out: Merchant[] = [];
  for (const [cat, account, kind, min, max, weight, names] of CATALOG) {
    for (const [i, name] of names.entries()) {
      out.push({ name, cat, weight: weight / (1 + i * 0.25), min, max, account, kind });
    }
  }
  const seen = new Set<string>();
  while (seen.size < P.locals) {
    const [prefix, cat] = pick(LOCAL_PREFIXES);
    const suffix =
      prefix.endsWith(" LE") || prefix.endsWith(" LA") ? pick(LOCAL_NOUNS) : pick(LOCAL_NAMES);
    const name = `${prefix} ${suffix}${seen.size >= 200 ? ` ${int(2, 99)}` : ""}`;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({
      name,
      cat: chance(0.75) ? cat : null,
      weight: 0.08 + rand() * 0.25,
      min: 3,
      max: 60,
      account: pick(["courant", "joint", "carte"] as const),
      kind: "CARD",
      local: true,
    });
  }
  return out;
}

type Tx = {
  account: AccountKey;
  date: Date;
  amount: number;
  raw: string;
  label: string;
  type: Kind;
  category: string | null;
  manual: boolean;
  pairKey?: string;
};

const CARD_REF = { courant: "4521", joint: "7782", carte: "0093", livret: "", pel: "" } as const;

// Bank-specific raw label formats, as an import would store them.
function cardLabel(account: AccountKey, name: string, d: Date): string {
  const dd = pad(d.getUTCDate());
  const mm = pad(d.getUTCMonth() + 1);
  const yy = String(d.getUTCFullYear()).slice(2);
  switch (account) {
    case "joint":
      return `PAIEMENT PAR CARTE X${CARD_REF.joint} ${name} ${dd}/${mm}`;
    case "carte":
      return `CB ${name} ${dd}/${mm} ${pick(CITIES)}`;
    default:
      return `CARTE ${dd}/${mm}/${yy} ${name} CB*${CARD_REF.courant}`;
  }
}

function monthTransactions(
  y: number,
  m0: number,
  merchants: Merchant[],
  totalWeight: number,
  variableCount: number,
): Tx[] {
  const last = new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
  const day = (d: number) => new Date(Date.UTC(y, m0, Math.min(d, last)));
  const out: Tx[] = [];
  const ref = () => hex(10).toUpperCase();
  const mm = `${pad(m0 + 1)}/${y}`;
  const fixed = (
    account: AccountKey,
    d: number,
    amount: number,
    raw: string,
    type: Kind,
    category: string | null,
    pairKey?: string,
  ) =>
    out.push({
      account,
      date: day(d),
      amount,
      raw,
      label: raw,
      type,
      category,
      manual: false,
      pairKey,
    });

  fixed(
    "courant",
    28,
    2650 + (y - 2020) * 60,
    `VIR SEPA RECU /DE ACME SAS /MOTIF SALAIRE ${mm} /REF ${ref()}`,
    "TRANSFER",
    "Salaire",
  );
  fixed(
    "joint",
    27,
    2180 + (y - 2020) * 40,
    `VIR SEPA SALAIRE GLOBEX FRANCE ${mm} REF ${ref()}`,
    "TRANSFER",
    "Salaire",
  );
  if (m0 === 11)
    fixed(
      "courant",
      20,
      800,
      `VIR SEPA RECU /DE ACME SAS /MOTIF PRIME ANNUELLE`,
      "TRANSFER",
      "Salaire",
    );
  fixed(
    "courant",
    2,
    -950,
    `VIR SEPA EMIS /MOTIF ALIMENTATION COMPTE JOINT /REF ${ref()}`,
    "TRANSFER",
    null,
    `joint-${y}-${m0}`,
  );
  fixed(
    "joint",
    2,
    950,
    `VIR SEPA DE MME CAMILLE MARTIN ALIMENTATION`,
    "TRANSFER",
    null,
    `joint-${y}-${m0}`,
  );
  fixed(
    "courant",
    29,
    -200,
    `VIR SEPA EMIS /MOTIF EPARGNE LIVRET A /REF ${ref()}`,
    "TRANSFER",
    null,
    `livret-${y}-${m0}`,
  );
  fixed("livret", 29, 200, `VIR DEPUIS COMPTE COURANT`, "TRANSFER", null, `livret-${y}-${m0}`);
  // Left unlinked on purpose: feeds the link suggestions.
  fixed("courant", 6, -150, `VIR SEPA EMIS /MOTIF VERSEMENT PEL /REF ${ref()}`, "TRANSFER", null);
  fixed("pel", 6, 150, `VERSEMENT PERIODIQUE PEL`, "OTHER", null);
  fixed(
    "courant",
    5,
    -money(300, 900),
    `PRLV SEPA CARTE DIFFEREE X${CARD_REF.carte} ${mm}`,
    "DIRECT_DEBIT",
    null,
  );
  fixed(
    "joint",
    5,
    -1290,
    `PRLV SEPA FONCIA GESTION LOYER ECH/${pad(m0 + 1)}${y} ID EMETTEUR/FR12ZZZ456789`,
    "DIRECT_DEBIT",
    "Loyer & prêt",
  );
  const winter = [0, 1, 2, 10, 11].includes(m0);
  fixed(
    "joint",
    10,
    -money(winter ? 85 : 50, winter ? 140 : 70),
    `PRLV SEPA EDF CLIENTS PARTICULIERS ECH/${pad(m0 + 1)}${y} REF ${ref()}`,
    "DIRECT_DEBIT",
    "Électricité & gaz",
  );
  fixed(
    "joint",
    12,
    -34.99,
    `PRLV SEPA SFR FIXE ADSL ${ref()}`,
    "DIRECT_DEBIT",
    "Internet & téléphone",
  );
  fixed(
    "joint",
    15,
    -18.5,
    `PRLV SEPA MAIF ASSURANCE HABITATION ${ref()}`,
    "DIRECT_DEBIT",
    "Charges",
  );
  fixed(
    "joint",
    15,
    -42.3,
    `PRLV SEPA MACIF AUTO CONTRAT ${ref()}`,
    "DIRECT_DEBIT",
    "Assurance auto",
  );
  fixed(
    "courant",
    18,
    -15.99,
    `PRLV SEPA FREE MOBILE ${ref()}`,
    "DIRECT_DEBIT",
    "Internet & téléphone",
  );
  fixed("courant", 3, -42, `PRLV SEPA HARMONIE MUTUELLE ${ref()}`, "DIRECT_DEBIT", "Mutuelle");
  fixed(
    "courant",
    15,
    -money(180, 260),
    `PRLV SEPA DGFIP IMPOT PRELEVEMENT ${ref()}`,
    "DIRECT_DEBIT",
    "Impôts",
  );
  fixed("carte", 8, -13.49, cardLabel("carte", "NETFLIX.COM", day(8)), "CARD", "Abonnements");
  fixed("carte", 20, -11.12, cardLabel("carte", "SPOTIFY", day(20)), "CARD", "Abonnements");
  fixed("courant", 4, -29.99, `PRLV SEPA BASIC FIT ${ref()}`, "DIRECT_DEBIT", "Sport");
  fixed(
    "joint",
    7,
    -money(320, 480),
    `PRLV SEPA CRECHE LES PETITS LOUPS ${ref()}`,
    "DIRECT_DEBIT",
    "Garde d'enfants",
  );
  fixed("courant", 1, -2.5, `FRAIS TENUE DE COMPTE`, "OTHER", "Frais bancaires");
  if (m0 !== 7)
    fixed(
      "courant",
      1,
      -86.4,
      cardLabel("courant", "NAVIGO MOIS", day(1)),
      "CARD",
      "Transports en commun",
    );
  if (m0 === 11)
    fixed("livret", 31, money(95, 115), `INTERETS LIVRET A ${y}`, "OTHER", "Autres revenus");
  if (m0 === 9)
    fixed(
      "courant",
      15,
      -money(800, 1200),
      `PRLV SEPA DGFIP TAXE FONCIERE ${ref()}`,
      "DIRECT_DEBIT",
      "Impôts",
    );

  for (let i = 0; i < variableCount; i++) {
    let r = rand() * totalWeight;
    let m = merchants[0];
    for (const x of merchants) {
      r -= x.weight;
      if (r <= 0) {
        m = x;
        break;
      }
    }
    const d = day(int(1, last));
    const amount = -money(m.min, m.max);
    const raw = cardLabel(m.account, m.name, d);
    const manual = chance(0.12);
    out.push({
      account: m.account,
      date: d,
      amount,
      raw: manual ? m.name : raw,
      label: manual ? m.name.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase()) : raw,
      type: m.kind,
      category: manual && chance(0.3) ? null : m.cat,
      manual,
    });
  }
  for (let i = int(1, 3) * P.scale; i > 0; i--) {
    const d = day(int(1, last));
    out.push({
      account: "courant",
      date: d,
      amount: -pick([20, 40, 50, 60, 100]),
      raw: `RETRAIT DAB ${pad(d.getUTCDate())}/${pad(m0 + 1)} ${pick(CITIES)} CB*${CARD_REF.courant}`,
      label: "",
      type: "ATM",
      category: null,
      manual: false,
    });
  }
  if (chance(0.5)) {
    const d = int(1, last - 5);
    out.push({
      account: "courant",
      date: day(d + 4),
      amount: money(15, 60),
      raw: `VIR SEPA RECU /DE CPAM PARIS /MOTIF REMBOURSEMENT SOINS ${ref()}`,
      label: "",
      type: "TRANSFER",
      category: "Remboursements",
      manual: false,
    });
  }
  if (chance(0.3))
    out.push({
      account: "courant",
      date: day(int(1, last)),
      amount: -money(20, 200),
      raw: `CHEQUE N ${int(1000000, 9999999)}`,
      label: "",
      type: "CHEQUE",
      category: null,
      manual: false,
    });
  if (chance(0.25))
    out.push({
      account: "courant",
      date: day(int(1, last)),
      amount: money(10, 90),
      raw: `VIR SEPA RECU /DE ${pick(LOCAL_NAMES)} ${pick(["THOMAS", "JULIE", "MARC", "SOPHIE"])} /MOTIF REMBOURSEMENT`,
      label: "",
      type: "TRANSFER",
      category: chance(0.5) ? "Remboursements" : null,
      manual: false,
    });
  for (const t of out) if (!t.label) t.label = t.raw;
  return out;
}

const CUSTOM_CATEGORIES: [string, string[]][] = [
  ["Alimentation", ["Boulangerie", "Marché"]],
  ["Logement", ["Travaux", "Ameublement"]],
  ["Transport", ["Parking & péage", "Assurance auto", "Vélo"]],
  ["Loisirs", ["Livres & presse", "Jeux vidéo", "Sport", "Musique", "Concerts", "Musées"]],
  ["Santé", ["Dentiste", "Optique", "Kiné"]],
  ["Achats", ["Coiffeur & beauté", "Cadeaux", "Jardin", "Tabac", "Électroménager"]],
  ["Enfants", ["Garde d'enfants", "Enfants", "École", "Activités enfants", "Vêtements enfants"]],
  ["Animaux", ["Animalerie", "Vétérinaire", "Assurance animaux"]],
  ["Impôts & taxes", ["Impôts", "Taxe foncière", "Amendes"]],
  ["Banque", ["Frais bancaires", "Agios", "Intérêts"]],
  ["Épargne", ["Livret", "PEL", "Assurance vie", "Bourse"]],
  ["Dons", ["Associations", "Dons ponctuels"]],
  ["Professionnel", ["Notes de frais", "Formation", "Matériel pro"]],
];

function flatten(tree: CategoryNode[]): { id: string; name: string }[] {
  return tree.flatMap((n) => [{ id: n.id, name: n.name }, ...flatten(n.children)]);
}

let idSeq = 0;
const idBase = Date.UTC(2026, 0, 1);
// Monotonic cuid-like ids, so the clustered PK fills in insertion order as Prisma's cuid() would.
function newId(): string {
  idSeq++;
  return `c${(idBase + idSeq).toString(36)}${hex(16)}`;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function signUp(email: string, name: string): Promise<string> {
  const existing = await db.user.findUnique({ where: { email } });
  if (existing)
    throw new Error(`${email} already exists: rebuild budget_perf with npm run perf:db`);
  const auth = await getAuth();
  const res = await auth.api.signUpEmail({ body: { email, password: PASSWORD, name } });
  await db.user.update({ where: { id: res.user.id }, data: { emailVerified: true } });
  return res.user.id;
}

async function main(): Promise<void> {
  const t0 = Date.now();
  await seedRolesAndPermissions(db);
  await seedAppSettings(db);
  await db.appSetting.upsert({
    where: { key: "registration_mode" },
    update: { value: "OPEN" as never },
    create: { key: "registration_mode", value: "OPEN" as never },
  });

  const userId = await signUp(EMAIL, `Perf ${profileName}`);
  const partnerId = await signUp(PARTNER, `Partner ${profileName}`);
  const actor = { id: userId };
  await grantRole(db, userId, "SUPER_ADMIN", userId);
  await seedDefaultCategories(userId, "fr", db);
  await seedDefaultCategories(partnerId, "fr", db);

  const roots = await db.category.findMany({ where: { userId, parentId: null } });
  for (const [parent, children] of CUSTOM_CATEGORIES) {
    let p = roots.find((r) => r.name === parent);
    if (!p) p = await db.category.create({ data: { name: parent, userId, color: "#7c3aed" } });
    for (const c of children)
      await db.category.create({ data: { name: c, parentId: p.id, userId } });
  }
  const cats = flatten(await listForUser(userId));
  const catId = (name: string) => {
    const id = cats.find((c) => c.name === name)?.id;
    if (!id) throw new Error(`Unknown category: ${name}`);
    return id;
  };

  const mk = (
    name: string,
    type: string,
    bankName: string,
    color: string,
    initialBalance: number,
  ) =>
    db.bankAccount
      .create({ data: { ownerId: userId, name, type, bankName, color, initialBalance } })
      .then((a) => a.id);
  const acc: Record<AccountKey, string> = {
    courant: await mk("Compte courant", "CHECKING", "Boursorama", "#2563eb", 1200),
    livret: await mk("Livret A", "SAVINGS", "Boursorama", "#16a34a", 6000),
    joint: await mk("Compte joint", "CHECKING", "Crédit Agricole", "#d97706", 800),
    carte: await mk("Carte Visa Premier", "CREDIT", "Boursorama", "#db2777", 0),
    pel: await mk("PEL", "SAVINGS", "Crédit Agricole", "#0891b2", 3000),
  };
  const { id: groupId } = await createGroup(
    { name: "Foyer Martin", description: "Compte joint" },
    userId,
  );
  await db.groupMember.create({ data: { groupId, userId: partnerId, role: "MEMBER" } });
  await shareAccountWithGroup({ accountId: acc.joint, groupId, permission: "WRITE" }, actor);
  const groupCats: string[] = [];
  for (const name of ["Courses foyer", "Charges foyer", "Vacances foyer", "Enfants foyer"]) {
    groupCats.push((await db.category.create({ data: { name, groupId } })).id);
  }

  // Transactions
  const merchants = buildMerchants();
  const totalWeight = merchants.reduce((s, m) => s + m.weight, 0);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const fixedPerMonth = 27 + 2 * P.scale;
  const variablePerMonth = Math.max(0, Math.round(P.target / MONTHS) - fixedPerMonth);
  const txs: Tx[] = [];
  for (let back = MONTHS - 1; back >= 0; back--) {
    const ref = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - back, 1));
    const n = Math.round(variablePerMonth * (0.85 + rand() * 0.3));
    txs.push(
      ...monthTransactions(ref.getUTCFullYear(), ref.getUTCMonth(), merchants, totalWeight, n),
    );
  }
  const rows = txs.filter((t) => t.date <= today).sort((a, b) => +a.date - +b.date);

  // Recent months land in import batches (3 per imported account), like a user importing monthly.
  const batchOf = new Map<string, string>();
  for (const key of ["courant", "joint", "carte"] as const) {
    for (let back = 2; back >= 0; back--) {
      const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - back, 1));
      const b = await db.importBatch.create({
        data: {
          accountId: acc[key],
          source: "CSV",
          filename: `releve-${key}-${start.toISOString().slice(0, 7)}.csv`,
          status: "COMPLETED",
          createdById: userId,
          completedAt: new Date(start.getTime() + 32 * 86_400_000),
          metadata: { fileSizeBytes: 40_000 },
        },
      });
      batchOf.set(`${key}|${start.toISOString().slice(0, 7)}`, b.id);
    }
  }

  const extIds = new Map<Tx, string>();
  for (const key of Object.keys(acc) as AccountKey[]) {
    const imported = rows.filter((t) => t.account === key && !t.manual);
    const ids = computeExternalIds(
      imported.map((t) => ({ date: t.date, amount: t.amount, rawLabel: t.raw })),
    );
    imported.forEach((t, i) => extIds.set(t, ids[i]));
  }

  const txIdOf = new Map<Tx, string>();
  const CHUNK = 2000;
  let tokenRows = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const data: Prisma.TransactionCreateManyInput[] = [];
    const tokens: { transactionId: string; tokenHash: string }[] = [];
    for (const t of chunk) {
      const id = newId();
      txIdOf.set(t, id);
      const secure = buildSecureFields({
        label: t.label,
        rawLabel: t.raw,
        note: t.manual && chance(0.2) ? "Note perso" : null,
      });
      const ext = extIds.get(t) ?? null;
      data.push({
        id,
        accountId: acc[t.account],
        date: t.date,
        amount: t.amount,
        type: t.type,
        labelEnc: secure.labelEnc,
        labelHash: secure.labelHash,
        rawLabelEnc: secure.rawLabelEnc,
        rawLabelHash: secure.rawLabelHash,
        noteEnc: secure.noteEnc,
        categoryId: t.category ? catId(t.category) : null,
        manuallyCategorized: t.manual && t.category !== null,
        externalId: ext,
        importBatchId: ext
          ? (batchOf.get(`${t.account}|${t.date.toISOString().slice(0, 7)}`) ?? null)
          : null,
        createdById: userId,
        createdAt: new Date(t.date.getTime() + int(1, 20) * 86_400_000),
      });
      for (const tokenHash of secure.tokens) tokens.push({ transactionId: id, tokenHash });
    }
    await db.transaction.createMany({ data });
    for (let j = 0; j < tokens.length; j += 10_000) {
      await db.transactionSearchToken.createMany({ data: tokens.slice(j, j + 10_000) });
    }
    tokenRows += tokens.length;
    process.stdout.write(
      `\r${Math.min(i + CHUNK, rows.length)}/${rows.length} tx, ${tokenRows} tokens`,
    );
  }
  console.log();
  for (const id of batchOf.values()) {
    const n = await db.transaction.count({ where: { importBatchId: id } });
    await db.importBatch.update({ where: { id }, data: { totalRows: n, importedRows: n } });
  }

  // Links: monthly transfers between owned accounts.
  const pairs = new Map<string, string[]>();
  for (const t of rows)
    if (t.pairKey) pairs.set(t.pairKey, [...(pairs.get(t.pairKey) ?? []), txIdOf.get(t)!]);
  let links = 0;
  for (const ids of pairs.values()) {
    if (ids.length !== 2) continue;
    await createLink({ transactionIds: ids, userId });
    links++;
  }

  // Rules: one per named merchant (mixed match types), then fillers up to the target count.
  type RuleRow = Prisma.CategorizationRuleCreateManyInput;
  const rules: RuleRow[] = [];
  const named = merchants.filter((m) => m.cat);
  for (const [i, m] of named.entries()) {
    if (rules.length >= P.rules) break;
    let pattern = m.name;
    let matchType = "CONTAINS";
    if (i % 10 === 3) {
      matchType = "REGEX";
      pattern = `(CB|CARTE|PAIEMENT PAR CARTE).*${escapeRe(m.name.split(" ")[0])}`;
    } else if (i % 9 === 5) {
      matchType = "STARTS_WITH";
      pattern =
        m.account === "joint"
          ? `PAIEMENT PAR CARTE X${CARD_REF.joint} ${m.name}`
          : m.account === "carte"
            ? `CB ${m.name}`
            : "CARTE ";
      if (pattern === "CARTE ") {
        matchType = "CONTAINS";
        pattern = m.name;
      }
    } else if (i % 23 === 7) {
      matchType = "EXACT";
      pattern = m.name;
    }
    rules.push({
      id: newId(),
      pattern,
      matchType,
      caseSensitive: false,
      priority: chance(0.1) ? 200 : 100,
      categoryId: catId(m.cat!),
      userId,
      hits: int(0, 400),
    });
  }
  const fixedRules: [string, string, string][] = [
    ["SALAIRE", "CONTAINS", "Salaire"],
    ["FONCIA", "CONTAINS", "Loyer & prêt"],
    ["PRLV SEPA EDF", "STARTS_WITH", "Électricité & gaz"],
    ["SFR", "CONTAINS", "Internet & téléphone"],
    ["FREE MOBILE", "CONTAINS", "Internet & téléphone"],
    ["HARMONIE MUTUELLE", "CONTAINS", "Mutuelle"],
    ["DGFIP", "CONTAINS", "Impôts"],
    ["NETFLIX", "CONTAINS", "Abonnements"],
    ["SPOTIFY", "CONTAINS", "Abonnements"],
    ["BASIC FIT", "CONTAINS", "Sport"],
    ["CRECHE", "CONTAINS", "Garde d'enfants"],
    ["FRAIS TENUE DE COMPTE", "EXACT", "Frais bancaires"],
    ["NAVIGO", "CONTAINS", "Transports en commun"],
    ["CPAM", "CONTAINS", "Remboursements"],
    ["MACIF AUTO", "CONTAINS", "Assurance auto"],
    ["MAIF", "CONTAINS", "Charges"],
    ["^INTERETS LIVRET", "REGEX", "Autres revenus"],
    ["TAXE FONCIERE", "CONTAINS", "Impôts"],
  ];
  for (const [pattern, matchType, cat] of fixedRules) {
    rules.push({
      id: newId(),
      pattern,
      matchType,
      caseSensitive: false,
      priority: 150,
      categoryId: catId(cat),
      userId,
      hits: int(10, 72),
    });
  }
  // Household rules on the group's own categories.
  for (let i = 0; i < 20; i++) {
    rules.push({
      id: newId(),
      pattern: `FOYER ${pick(LOCAL_NAMES)} ${i}`,
      matchType: "CONTAINS",
      caseSensitive: false,
      priority: 100,
      categoryId: pick(groupCats),
      groupId,
      hits: 0,
    });
  }
  const leafCats = cats.filter((c) => !["Revenus", "Divers"].includes(c.name));
  let f = 0;
  while (rules.length < P.rules) {
    f++;
    const word = `${pick(LOCAL_NAMES)} ${pick(LOCAL_NOUNS)}`;
    const kind = f % 10;
    const matchType =
      kind === 0 ? "REGEX" : kind < 3 ? "STARTS_WITH" : kind === 3 ? "EXACT" : "CONTAINS";
    const pattern =
      matchType === "REGEX"
        ? `^(CB|CARTE) .*${word.split(" ")[0]}\\s+(${pick(LOCAL_NOUNS)}|${pick(LOCAL_NOUNS)})`
        : matchType === "STARTS_WITH"
          ? `CB ${word} ${f}`
          : `${word} ${f}`;
    rules.push({
      id: newId(),
      pattern,
      matchType,
      caseSensitive: chance(0.05),
      priority: pick([50, 100, 100, 100, 150]),
      categoryId: pick(leafCats).id,
      userId,
      hits: int(0, 30),
      enabled: chance(0.95),
    });
  }
  await db.categorizationRule.createMany({ data: rules });

  // Budgets: a monthly recurring chain (12 instances), a quarterly household chain, and one-offs.
  const isoDay = (d: Date) => d.toISOString().slice(0, 10);
  const monthBounds = (offset: number) => ({
    start: isoDay(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + offset, 1))),
    end: isoDay(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + offset + 1, 0))),
  });
  const m11 = monthBounds(-11);
  let budgetId = (
    await createBudget(
      {
        name: "Budget mensuel",
        periodType: "MONTH",
        periodStart: m11.start,
        periodEnd: m11.end,
        recurring: true,
        lines: [
          "Restaurants",
          "Café & snacks",
          "Sorties",
          "Abonnements",
          "Courses",
          "Vêtements",
          "Livres & presse",
          "Transports en commun",
        ].map((c) => ({ categoryId: catId(c), plannedAmount: int(30, 400) })),
      },
      actor,
    )
  ).id;
  let budgets = 1;
  for (let i = 0; i < 11; i++) {
    const r = await rollRecurring(budgetId, actor);
    if (r.id) {
      budgetId = r.id;
      budgets++;
    }
  }
  const qStartMonth = today.getUTCMonth() - (today.getUTCMonth() % 3) - 9;
  let qId = (
    await createBudget(
      {
        name: "Charges du foyer",
        groupId,
        periodType: "QUARTER",
        periodStart: isoDay(new Date(Date.UTC(today.getUTCFullYear(), qStartMonth, 1))),
        periodEnd: isoDay(new Date(Date.UTC(today.getUTCFullYear(), qStartMonth + 3, 0))),
        recurring: true,
        lines: [
          { categoryId: groupCats[0], plannedAmount: 1500 },
          { categoryId: groupCats[1], plannedAmount: 600 },
          { accountId: acc.joint, label: "Tout le compte joint", plannedAmount: 9000 },
        ],
      },
      actor,
    )
  ).id;
  budgets++;
  for (let i = 0; i < 3; i++) {
    const r = await rollRecurring(qId, actor);
    if (r.id) {
      qId = r.id;
      budgets++;
    }
  }
  for (const [name, start, end, type] of [
    [
      "Vacances été",
      `${today.getUTCFullYear()}-07-01`,
      `${today.getUTCFullYear()}-08-31`,
      "CUSTOM",
    ],
    ["Noël", `${today.getUTCFullYear() - 1}-12-01`, `${today.getUTCFullYear() - 1}-12-31`, "MONTH"],
    [
      "Année en cours",
      `${today.getUTCFullYear()}-01-01`,
      `${today.getUTCFullYear()}-12-31`,
      "YEAR",
    ],
    [
      "Année précédente",
      `${today.getUTCFullYear() - 1}-01-01`,
      `${today.getUTCFullYear() - 1}-12-31`,
      "YEAR",
    ],
  ] as const) {
    await createBudget(
      {
        name,
        periodType: type,
        periodStart: start,
        periodEnd: end,
        lines: ["Voyages", "Cadeaux", "Restaurants", "Courses", "High-tech", "Maison"].map((c) => ({
          categoryId: catId(c),
          plannedAmount: int(100, 3000),
        })),
      },
      actor,
    );
    budgets++;
  }

  for (const m of named.slice(0, 10)) {
    await renameMerchant(
      userId,
      merchantKey(cardLabel(m.account, m.name, today)),
      `${m.name.toLowerCase()} (alias)`,
    );
  }

  // Audit trail roughly matching the activity (manual entries are logged one by one).
  const audit: Prisma.AuditLogCreateManyInput[] = [];
  for (const t of rows) {
    if (t.manual)
      audit.push({
        userId,
        action: "transaction.created",
        entity: "Transaction",
        entityId: txIdOf.get(t),
        createdAt: t.date,
      });
  }
  for (let i = 0; i < MONTHS * 3; i++)
    audit.push({
      userId,
      action: "auth.sign_in",
      createdAt: new Date(today.getTime() - i * 10 * 3_600_000),
    });
  for (let i = 0; i < audit.length; i += 5000)
    await db.auditLog.createMany({ data: audit.slice(i, i + 5000) });

  console.log(
    `Seeded ${EMAIL} / ${PASSWORD}: ${rows.length} tx (${rows.filter((t) => t.manual).length} manual), ${tokenRows} tokens, ` +
      `${cats.length} categories (+${groupCats.length} group), ${rules.length} rules, ${links} links, ${budgets} budgets, ` +
      `${batchOf.size} import batches, ${audit.length} audit rows in ${((Date.now() - t0) / 1000).toFixed(0)} s`,
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
