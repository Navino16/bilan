/* Mock data for Bilan — French personal finance */

const TODAY = new Date("2026-05-26");
const CURRENT_USER = {
  id: "u_pierre",
  name: "Pierre Dupont",
  email: "pierre.dupont@example.fr",
  initials: "PD",
  role: "SUPER_ADMIN"
};
const HOUSEHOLD = {
  id: "g_foyer",
  name: "Foyer Dupont",
  members: [{
    id: "u_pierre",
    name: "Pierre Dupont",
    initials: "PD",
    role: "OWNER"
  }, {
    id: "u_claire",
    name: "Claire Dupont",
    initials: "CD",
    role: "ADMIN"
  }],
  pending: [{
    email: "thomas.martin@example.fr",
    role: "MEMBER",
    invitedAt: "il y a 2 j"
  }]
};
const ACCOUNTS = [{
  id: "a_courant",
  name: "Compte courant",
  bank: "Crédit Coopératif",
  type: "CHECKING",
  balance: 3842.17,
  color: "var(--cat-transport)",
  owner: "u_pierre",
  sharedWith: ["g_foyer"],
  permission: "WRITE",
  iban: "FR76 4255 9100 0008 1234 5678 901"
}, {
  id: "a_livret",
  name: "Livret A",
  bank: "Caisse d'Épargne",
  type: "SAVINGS",
  balance: 12400.00,
  color: "var(--cat-savings)",
  owner: "u_pierre",
  sharedWith: [],
  permission: null,
  iban: "FR76 1820 6020 0005 2233 4455 667"
}, {
  id: "a_joint",
  name: "Compte joint",
  bank: "BNP Paribas",
  type: "CHECKING",
  balance: 2148.54,
  color: "var(--cat-housing)",
  owner: "u_pierre",
  sharedWith: ["g_foyer"],
  permission: "WRITE",
  iban: "FR76 3000 4000 0312 3456 7890 123"
}, {
  id: "a_pea",
  name: "PEA",
  bank: "Boursorama",
  type: "OTHER",
  balance: 8732.92,
  color: "var(--cat-leisure)",
  owner: "u_pierre",
  sharedWith: [],
  permission: null,
  iban: null
}, {
  id: "a_claire",
  name: "Compte Claire",
  bank: "Crédit Mutuel",
  type: "CHECKING",
  balance: 1612.30,
  color: "var(--cat-food)",
  owner: "u_claire",
  sharedWith: ["g_foyer"],
  permission: "READ",
  iban: null
}];
const CATEGORIES = [{
  id: "c_income",
  name: "Revenus",
  color: "var(--cat-income)",
  icon: "↗",
  parentId: null,
  scope: "user"
}, {
  id: "c_salary",
  name: "Salaire",
  color: "var(--cat-income)",
  icon: "↗",
  parentId: "c_income",
  scope: "user"
}, {
  id: "c_groceries",
  name: "Courses",
  color: "var(--cat-groceries)",
  icon: "○",
  parentId: null,
  scope: "group"
}, {
  id: "c_housing",
  name: "Logement",
  color: "var(--cat-housing)",
  icon: "▢",
  parentId: null,
  scope: "group"
}, {
  id: "c_rent",
  name: "Loyer",
  color: "var(--cat-housing)",
  icon: "▢",
  parentId: "c_housing",
  scope: "group"
}, {
  id: "c_energy",
  name: "Énergie",
  color: "var(--cat-housing)",
  icon: "▢",
  parentId: "c_housing",
  scope: "group"
}, {
  id: "c_transport",
  name: "Transports",
  color: "var(--cat-transport)",
  icon: "→",
  parentId: null,
  scope: "user"
}, {
  id: "c_food",
  name: "Restaurants",
  color: "var(--cat-food)",
  icon: "△",
  parentId: null,
  scope: "user"
}, {
  id: "c_leisure",
  name: "Loisirs",
  color: "var(--cat-leisure)",
  icon: "◇",
  parentId: null,
  scope: "user"
}, {
  id: "c_health",
  name: "Santé",
  color: "var(--cat-health)",
  icon: "+",
  parentId: null,
  scope: "user"
}, {
  id: "c_shopping",
  name: "Achats",
  color: "var(--cat-shopping)",
  icon: "□",
  parentId: null,
  scope: "user"
}, {
  id: "c_bills",
  name: "Abonnements",
  color: "var(--cat-bills)",
  icon: "≡",
  parentId: null,
  scope: "user"
}, {
  id: "c_savings",
  name: "Épargne",
  color: "var(--cat-savings)",
  icon: "★",
  parentId: null,
  scope: "user"
}, {
  id: "c_other",
  name: "Autre",
  color: "var(--cat-other)",
  icon: "·",
  parentId: null,
  scope: "user"
}];
const findCat = id => CATEGORIES.find(c => c.id === id);

// Generate transactions for May 2026
const TRANSACTIONS = [{
  id: "t01",
  date: "2026-05-25",
  amount: -42.18,
  label: "Carrefour Market",
  rawLabel: "CB CARREFOUR MARKET 0524",
  type: "CARD",
  accountId: "a_courant",
  categoryId: "c_groceries",
  note: ""
}, {
  id: "t02",
  date: "2026-05-25",
  amount: -8.50,
  label: "Boulangerie Paul",
  rawLabel: "CB PAUL PARIS 12 0524",
  type: "CARD",
  accountId: "a_courant",
  categoryId: "c_food",
  note: ""
}, {
  id: "t03",
  date: "2026-05-24",
  amount: -36.40,
  label: "SNCF — Paris Lyon",
  rawLabel: "CB SNCF CONNECT 0524",
  type: "CARD",
  accountId: "a_courant",
  categoryId: "c_transport",
  note: "Retour Lyon"
}, {
  id: "t04",
  date: "2026-05-24",
  amount: -18.90,
  label: "Netflix",
  rawLabel: "PRLV NETFLIX EUROPE",
  type: "DIRECT_DEBIT",
  accountId: "a_courant",
  categoryId: "c_bills",
  note: ""
}, {
  id: "t05",
  date: "2026-05-23",
  amount: -129.00,
  label: "EDF — Électricité",
  rawLabel: "PRLV EDF FACTURE",
  type: "DIRECT_DEBIT",
  accountId: "a_joint",
  categoryId: "c_energy",
  note: ""
}, {
  id: "t06",
  date: "2026-05-22",
  amount: -82.40,
  label: "Decathlon",
  rawLabel: "CB DECATHLON GENNEVI",
  type: "CARD",
  accountId: "a_courant",
  categoryId: "c_shopping",
  note: ""
}, {
  id: "t07",
  date: "2026-05-22",
  amount: -54.00,
  label: "Pharmacie de la Mairie",
  rawLabel: "CB PHARM MAIRIE 0522",
  type: "CARD",
  accountId: "a_courant",
  categoryId: "c_health",
  note: ""
}, {
  id: "t08",
  date: "2026-05-21",
  amount: -1240.00,
  label: "Loyer mai",
  rawLabel: "VIR LOYER MAI 2026",
  type: "TRANSFER",
  accountId: "a_joint",
  categoryId: "c_rent",
  note: ""
}, {
  id: "t09",
  date: "2026-05-21",
  amount: -29.99,
  label: "Spotify",
  rawLabel: "PRLV SPOTIFY",
  type: "DIRECT_DEBIT",
  accountId: "a_courant",
  categoryId: "c_bills",
  note: ""
}, {
  id: "t10",
  date: "2026-05-20",
  amount: -76.30,
  label: "Auchan",
  rawLabel: "CB AUCHAN 75017 0520",
  type: "CARD",
  accountId: "a_joint",
  categoryId: "c_groceries",
  note: ""
}, {
  id: "t11",
  date: "2026-05-19",
  amount: -22.50,
  label: "Bistrot Parmentier",
  rawLabel: "CB BISTROT PARMENTIER",
  type: "CARD",
  accountId: "a_courant",
  categoryId: "c_food",
  note: "Dîner avec Marc"
}, {
  id: "t12",
  date: "2026-05-18",
  amount: -64.20,
  label: "Total — Station",
  rawLabel: "CB TOTAL STATION A6",
  type: "CARD",
  accountId: "a_courant",
  categoryId: "c_transport",
  note: ""
}, {
  id: "t13",
  date: "2026-05-15",
  amount: 2980.00,
  label: "Salaire mai",
  rawLabel: "VIR ACME SARL SALAIRE",
  type: "TRANSFER",
  accountId: "a_courant",
  categoryId: "c_salary",
  note: ""
}, {
  id: "t14",
  date: "2026-05-15",
  amount: -500.00,
  label: "Virement épargne",
  rawLabel: "VIR LIVRET A",
  type: "TRANSFER",
  accountId: "a_courant",
  categoryId: "c_savings",
  note: ""
}, {
  id: "t15",
  date: "2026-05-15",
  amount: 500.00,
  label: "Virement épargne",
  rawLabel: "VIR DEPUIS COURANT",
  type: "TRANSFER",
  accountId: "a_livret",
  categoryId: "c_savings",
  note: ""
}, {
  id: "t16",
  date: "2026-05-14",
  amount: -38.70,
  label: "Carrefour Market",
  rawLabel: "CB CARREFOUR 0514",
  type: "CARD",
  accountId: "a_courant",
  categoryId: "c_groceries",
  note: ""
}, {
  id: "t17",
  date: "2026-05-13",
  amount: -14.80,
  label: "Le Petit Bar",
  rawLabel: "CB LE PETIT BAR",
  type: "CARD",
  accountId: "a_courant",
  categoryId: "c_food",
  note: ""
}, {
  id: "t18",
  date: "2026-05-12",
  amount: -240.00,
  label: "Théâtre des Bouffes",
  rawLabel: "CB FNAC SPECTACLES",
  type: "CARD",
  accountId: "a_courant",
  categoryId: "c_leisure",
  note: "4 places"
}, {
  id: "t19",
  date: "2026-05-11",
  amount: -49.99,
  label: "Free Mobile",
  rawLabel: "PRLV FREE MOBILE",
  type: "DIRECT_DEBIT",
  accountId: "a_courant",
  categoryId: "c_bills",
  note: ""
}, {
  id: "t20",
  date: "2026-05-10",
  amount: -68.50,
  label: "Monoprix",
  rawLabel: "CB MONOPRIX 0510",
  type: "CARD",
  accountId: "a_joint",
  categoryId: "c_groceries",
  note: ""
}, {
  id: "t21",
  date: "2026-05-09",
  amount: -32.00,
  label: "Uber",
  rawLabel: "CB UBER TRIP",
  type: "CARD",
  accountId: "a_courant",
  categoryId: "c_transport",
  note: ""
}, {
  id: "t22",
  date: "2026-05-08",
  amount: -89.90,
  label: "Zara",
  rawLabel: "CB ZARA HAUSSMANN",
  type: "CARD",
  accountId: "a_courant",
  categoryId: "c_shopping",
  note: ""
}, {
  id: "t23",
  date: "2026-05-07",
  amount: -16.00,
  label: "Boulangerie Paul",
  rawLabel: "CB PAUL PARIS 0507",
  type: "CARD",
  accountId: "a_courant",
  categoryId: "c_food",
  note: ""
}, {
  id: "t24",
  date: "2026-05-06",
  amount: -42.30,
  label: "Carrefour Market",
  rawLabel: "CB CARREFOUR 0506",
  type: "CARD",
  accountId: "a_courant",
  categoryId: "c_groceries",
  note: ""
}, {
  id: "t25",
  date: "2026-05-05",
  amount: -68.00,
  label: "Decathlon — Retour",
  rawLabel: "REMB CB DECATHLON",
  type: "CARD",
  accountId: "a_courant",
  categoryId: "c_shopping",
  note: "",
  linked: "L1"
}, {
  id: "t26",
  date: "2026-05-03",
  amount: 68.00,
  label: "Remboursement Decathlon",
  rawLabel: "REMB DECATHLON RETOUR",
  type: "CARD",
  accountId: "a_courant",
  categoryId: "c_shopping",
  note: "",
  linked: "L1"
}, {
  id: "t27",
  date: "2026-05-02",
  amount: -110.00,
  label: "Médecin spécialiste",
  rawLabel: "CB CABINET DR BOUVIER",
  type: "CARD",
  accountId: "a_courant",
  categoryId: "c_health",
  note: ""
}, {
  id: "t28",
  date: "2026-05-01",
  amount: 62.00,
  label: "Remb. Sécurité Sociale",
  rawLabel: "VIR CPAM",
  type: "TRANSFER",
  accountId: "a_courant",
  categoryId: "c_health",
  note: ""
}];
const BUDGETS = [{
  id: "b_may",
  name: "Mai 2026",
  scope: "user",
  period: {
    type: "MONTH",
    start: "2026-05-01",
    end: "2026-05-31"
  },
  lines: [{
    id: "bl1",
    categoryId: "c_groceries",
    planned: 400,
    spent: 226.18
  }, {
    id: "bl2",
    categoryId: "c_food",
    planned: 150,
    spent: 61.80
  }, {
    id: "bl3",
    categoryId: "c_transport",
    planned: 200,
    spent: 132.20
  }, {
    id: "bl4",
    categoryId: "c_leisure",
    planned: 200,
    spent: 240.00
  }, {
    id: "bl5",
    categoryId: "c_shopping",
    planned: 150,
    spent: 172.30
  }, {
    id: "bl6",
    categoryId: "c_bills",
    planned: 120,
    spent: 98.78
  }, {
    id: "bl7",
    categoryId: "c_health",
    planned: 100,
    spent: 102.00
  }]
}, {
  id: "b_household",
  name: "Foyer — mai",
  scope: "group",
  period: {
    type: "MONTH",
    start: "2026-05-01",
    end: "2026-05-31"
  },
  lines: [{
    id: "blh1",
    categoryId: "c_rent",
    planned: 1240,
    spent: 1240
  }, {
    id: "blh2",
    categoryId: "c_energy",
    planned: 140,
    spent: 129
  }]
}];
const RULES = [{
  id: "r1",
  pattern: "CARREFOUR",
  matchType: "CONTAINS",
  categoryId: "c_groceries",
  scope: "user",
  priority: 100,
  enabled: true,
  hits: 12
}, {
  id: "r2",
  pattern: "PAUL",
  matchType: "CONTAINS",
  categoryId: "c_food",
  scope: "user",
  priority: 90,
  enabled: true,
  hits: 8
}, {
  id: "r3",
  pattern: "NETFLIX|SPOTIFY|FREE MOBILE",
  matchType: "REGEX",
  categoryId: "c_bills",
  scope: "user",
  priority: 95,
  enabled: true,
  hits: 11
}, {
  id: "r4",
  pattern: "EDF",
  matchType: "STARTS_WITH",
  categoryId: "c_energy",
  scope: "group",
  priority: 100,
  enabled: true,
  hits: 6
}, {
  id: "r5",
  pattern: "SNCF|UBER|TOTAL",
  matchType: "REGEX",
  categoryId: "c_transport",
  scope: "user",
  priority: 80,
  enabled: true,
  hits: 9
}, {
  id: "r6",
  pattern: "ACME SARL",
  matchType: "CONTAINS",
  categoryId: "c_salary",
  scope: "user",
  priority: 100,
  enabled: true,
  hits: 5
}];

// Audit log entries
const AUDIT = [{
  ts: "26 mai · 14:02",
  actor: "Pierre Dupont",
  action: "transaction.import_batch",
  target: "Import CSV — 28 lignes",
  ip: "82.124.x.x"
}, {
  ts: "26 mai · 13:58",
  actor: "Pierre Dupont",
  action: "auth.login.success",
  target: "—",
  ip: "82.124.x.x"
}, {
  ts: "25 mai · 21:34",
  actor: "Claire Dupont",
  action: "transaction.update",
  target: "Carrefour Market → Courses",
  ip: "82.124.x.x"
}, {
  ts: "25 mai · 19:12",
  actor: "Pierre Dupont",
  action: "budget.assignment.create",
  target: "Mai 2026 → t12",
  ip: "82.124.x.x"
}, {
  ts: "24 mai · 09:41",
  actor: "Pierre Dupont",
  action: "account.share.create",
  target: "Compte joint → Foyer Dupont",
  ip: "82.124.x.x"
}, {
  ts: "22 mai · 08:30",
  actor: "système",
  action: "settings.smtp.update",
  target: "—",
  ip: "—"
}, {
  ts: "20 mai · 18:22",
  actor: "Pierre Dupont",
  action: "auth.2fa.enabled",
  target: "TOTP",
  ip: "82.124.x.x"
}, {
  ts: "18 mai · 11:05",
  actor: "Pierre Dupont",
  action: "group.invitation.create",
  target: "thomas.martin@…",
  ip: "82.124.x.x"
}];
const SESSIONS = [{
  id: "s1",
  device: "MacBook Pro — Safari",
  ip: "82.124.x.x · Paris",
  last: "À l'instant",
  current: true
}, {
  id: "s2",
  device: "iPhone 15 — Bilan",
  ip: "82.124.x.x · Paris",
  last: "il y a 2 h",
  current: false
}, {
  id: "s3",
  device: "Firefox — Linux",
  ip: "176.31.x.x · Lyon",
  last: "il y a 3 j",
  current: false
}];
const AUTH_PROVIDERS = [{
  id: "p1",
  type: "credentials",
  displayName: "Email + mot de passe",
  enabled: true,
  details: "argon2id · longueur min. 12 · verrouillage 5/15 min"
}, {
  id: "p2",
  type: "oidc",
  displayName: "Authentik (interne)",
  enabled: true,
  details: "https://auth.dupont.fr · scope openid email profile"
}, {
  id: "p3",
  type: "google",
  displayName: "Google",
  enabled: false,
  details: "client_id renseigné · désactivé"
}];

// SUMMARY HELPERS ---------------------------------------------------
const monthTotals = () => {
  const txs = TRANSACTIONS.filter(t => t.date.startsWith("2026-05"));
  const income = txs.filter(t => t.amount > 0 && t.categoryId !== "c_savings").reduce((a, b) => a + b.amount, 0);
  const expense = txs.filter(t => t.amount < 0 && t.categoryId !== "c_savings").reduce((a, b) => a + b.amount, 0);
  const saved = 500;
  return {
    income,
    expense: Math.abs(expense),
    saved,
    net: income + expense
  };
};

// Spending by category for the dashboard chart
const spendingByCategory = () => {
  const byCat = new Map();
  for (const t of TRANSACTIONS) {
    if (!t.date.startsWith("2026-05")) continue;
    if (t.amount >= 0) continue;
    if (t.categoryId === "c_savings") continue;
    const cur = byCat.get(t.categoryId) || 0;
    byCat.set(t.categoryId, cur + Math.abs(t.amount));
  }
  return [...byCat.entries()].map(([id, amount]) => ({
    category: findCat(id),
    amount
  })).sort((a, b) => b.amount - a.amount);
};

// Daily spending trace for sparkline
const dailySpend = () => {
  const days = {};
  for (let d = 1; d <= 31; d++) days[d] = 0;
  for (const t of TRANSACTIONS) {
    if (!t.date.startsWith("2026-05")) continue;
    if (t.amount >= 0) continue;
    const day = parseInt(t.date.slice(8, 10), 10);
    days[day] = (days[day] || 0) + Math.abs(t.amount);
  }
  return Object.entries(days).map(([d, v]) => ({
    day: +d,
    value: v
  }));
};

// Link suggestions
const LINK_SUGGESTIONS = [{
  id: "ls1",
  txA: "t27",
  txB: "t28",
  confidence: 0.88,
  gap: "1 j"
}];
const EXISTING_LINKS = [{
  id: "L1",
  name: "Decathlon — retour partiel",
  members: ["t25", "t26"],
  net: 0,
  balanced: true
}];
Object.assign(window, {
  TODAY,
  CURRENT_USER,
  HOUSEHOLD,
  ACCOUNTS,
  CATEGORIES,
  TRANSACTIONS,
  BUDGETS,
  RULES,
  AUDIT,
  SESSIONS,
  AUTH_PROVIDERS,
  LINK_SUGGESTIONS,
  EXISTING_LINKS,
  findCat,
  monthTotals,
  spendingByCategory,
  dailySpend
});