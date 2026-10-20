// Benchmarks pages, API routes and service flows against production builds: see docs/development.md.
// Usage: node scripts/perf/bench.mjs [--profile realistic|stress]... [--runs 10] [--warmup 2]
//          [--only <regex>] [--issue <n>] [--label <name>] <buildDir> [<buildDir>]
// With two builds (A/B), every run alternates between them so machine noise hits both alike.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

const require = createRequire(import.meta.url);
const mariadb = require("mariadb");

const { values: opts, positionals: buildDirs } = parseArgs({
  allowPositionals: true,
  options: {
    profile: { type: "string", multiple: true, default: ["realistic"] },
    runs: { type: "string", default: "10" },
    warmup: { type: "string", default: "2" },
    only: { type: "string" },
    issue: { type: "string" },
    label: { type: "string" },
  },
});
if (buildDirs.length < 1 || buildDirs.length > 2) {
  console.error("usage: bench.mjs [options] <buildDir> [<buildDir>] (see docs/development.md)");
  process.exit(1);
}
const RUNS = Number(opts.runs);
const WARMUP = Number(opts.warmup);
const PERF_DIR = process.env.BILAN_PERF_DIR ?? path.join(os.homedir(), ".cache/bilan-perf");
const PERF_ENV = Object.fromEntries(
  fs
    .readFileSync(path.join(PERF_DIR, "perf.env"), "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const PRELOAD = pathToFileURL(path.join(import.meta.dirname, "preload.mjs")).href;
const YEAR = new Date().getUTCFullYear();
const YEAR_RANGE = `from=${YEAR}-01-01&to=${YEAR}-12-31`;

// ── Scenarios ────────────────────────────────────────────────────────────────
// `issues` ties a scenario to the tickets it measures (--issue).

const page = (name, url, issues = []) => ({ name, issues, kind: "page", url });
const route = (name, method, url, issues = []) => ({ name, issues, kind: "route", method, url });
const flow = (name, issues = []) => ({ name, issues, kind: "flow" });

function csv(rows) {
  let a = 7;
  const rand = () => (a = (a * 1103515245 + 12345) % 2147483648) / 2147483648;
  const shops = [
    "CARREFOUR MARKET",
    "MONOPRIX",
    "LIDL",
    "PICARD",
    "UBER EATS",
    "STARBUCKS",
    "FNAC",
  ];
  const lines = ["Date opération;Libellé;Montant"];
  for (let i = 0; i < rows; i++) {
    const d = new Date(Date.UTC(2030, 0, 1) + Math.floor(rand() * 365) * 86_400_000);
    const day = `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const shop = shops[Math.floor(rand() * shops.length)];
    const amount = (-(1 + rand() * 150)).toFixed(2).replace(".", ",");
    lines.push(`${day}/2030;CARTE ${day} ${shop} REF${i} CB*4521;${amount}`);
  }
  return lines.join("\n") + "\n";
}

async function previewImport(ctx, rows) {
  const form = new FormData();
  form.set("accountId", ctx.ids.account);
  form.set("file", new Blob([csv(rows)], { type: "text/csv" }), `perf-${rows}.csv`);
  const { ms, buf } = await request(ctx, { method: "POST", url: "/api/import/csv", body: form });
  return { ms, preview: JSON.parse(buf.toString()) };
}
async function dropBatch(ctx, batchId) {
  await ctx.sql.query("DELETE FROM `Transaction` WHERE importBatchId = ?", [batchId]);
  await ctx.sql.query("DELETE FROM ImportBatch WHERE id = ?", [batchId]);
}

const importPreview = (rows, issues) => ({
  name: `import-preview-${rows}`,
  issues,
  kind: "custom",
  measure: async (ctx) => {
    const { ms, preview } = await previewImport(ctx, rows);
    return { ms, state: preview.batchId };
  },
  cleanup: (ctx, batchId) => dropBatch(ctx, batchId),
});
const importCommit = (rows, issues) => ({
  name: `import-commit-${rows}`,
  issues,
  kind: "custom",
  prepare: async (ctx) => (await previewImport(ctx, rows)).preview,
  measure: async (ctx, preview) => {
    const { ms } = await request(ctx, {
      method: "POST",
      url: `/api/import/csv/${preview.batchId}/commit`,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mapping: preview.mapping }),
    });
    return { ms, state: preview.batchId };
  },
  cleanup: (ctx, batchId) => dropBatch(ctx, batchId),
});

const SCENARIOS = [
  page("dashboard", "/fr/dashboard", [298, 300, 303]),
  page("dashboard-year", `/fr/dashboard?${YEAR_RANGE}`, [298, 299]),
  page("transactions", "/fr/transactions", [295, 298, 300, 303]),
  page("tx-filter-category", (ids) => `/fr/transactions?categoryId=${ids.category}`, [300]),
  page(
    "tx-filter-account",
    (ids) => `/fr/transactions?accountId=${ids.account}&dir=out&min=20`,
    [300],
  ),
  page("tx-sort-amount", "/fr/transactions?sort=amount-desc", [300]),
  page("tx-search-common", "/fr/transactions?search=carrefour", [297]),
  page("tx-search-rare", "/fr/transactions?search=gibert", [297]),
  page("tx-search-multi", "/fr/transactions?search=paiement%20carte%20monoprix", [297]),
  page("tx-search-prefix", "/fr/transactions?search=car", [297]),
  page("tx-suggestions", "/fr/transactions/suggestions"),
  page("insights", "/fr/insights", [298, 299, 303]),
  page("insights-year", `/fr/insights?${YEAR_RANGE}`, [298, 299]),
  page("budgets", "/fr/budgets", [299, 303]),
  page("budget-detail", (ids) => `/fr/budgets/${ids.budget}`, [299]),
  page("categories", "/fr/categories", [295, 296, 303]),
  page("accounts", "/fr/accounts", [300, 304]),
  page("groups", "/fr/groups"),
  page("group-detail", (ids) => `/fr/groups/${ids.group}`),
  page("settings-data", "/fr/settings/data"),
  page("admin-audit", "/fr/admin/audit"),
  route("export-tx-year", "GET", `/api/export/transactions?locale=fr&${YEAR_RANGE}`, [301]),
  route("export-tx-all", "GET", "/api/export/transactions?locale=fr", [295, 301]),
  route("export-rules", "GET", "/api/export/rules"),
  route("export-data", "GET", "/api/export/data", [295, 301]),
  route("cron-roll-budgets", "POST", "/api/cron/roll-budgets", [304]),
  importPreview(500, [295]),
  importPreview(5000, [295, 301]),
  importCommit(500, [295]),
  importCommit(5000, [295, 301]),
  flow("reclassify-preview-all", [295, 302]),
  flow("reclassify-preview-one", [295, 302]),
  flow("link-suggestions"),
  flow("rules-import-preview", [304]),
  flow("rules-import-commit", [304]),
];

// ── Servers and flow workers ─────────────────────────────────────────────────

const children = [];
process.on("exit", () => children.forEach((c) => c.kill("SIGKILL")));
process.on("SIGINT", () => process.exit(130));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Build {
  constructor(dir, index) {
    this.dir = path.resolve(dir);
    this.name = buildDirs.length === 2 ? "AB"[index] : "";
    this.port = 3410 + index;
    this.base = `http://127.0.0.1:${this.port}`;
    this.origin = `http://localhost:${this.port}`;
    this.statsFile = path.join(PERF_DIR, `stats-${this.port}.jsonl`);
    this.cookies = new Map();
    this.assets = new Map();
  }

  async start() {
    const server = path.join(this.dir, ".next/standalone/server.js");
    if (!fs.existsSync(server))
      throw new Error(`${this.dir} is not a build: run scripts/perf/build.sh`);
    if (
      await fetch(`${this.base}/fr/login`).then(
        () => true,
        () => false,
      )
    ) {
      throw new Error(`Port ${this.port} is already in use`);
    }
    fs.writeFileSync(this.statsFile, "");
    const log = fs.openSync(path.join(PERF_DIR, `server-${this.port}.log`), "w");
    this.proc = spawn(process.execPath, ["--import", PRELOAD, "server.js"], {
      cwd: path.dirname(server),
      stdio: ["ignore", log, log],
      env: {
        ...process.env,
        ...PERF_ENV,
        NODE_ENV: "production",
        PORT: String(this.port),
        HOSTNAME: "127.0.0.1",
        APP_URL: this.origin,
        PERF_STATS_FILE: this.statsFile,
      },
    });
    children.push(this.proc);
    for (let i = 0; i < 120; i++) {
      const up = await fetch(`${this.base}/fr/login`).then(
        (r) => r.ok,
        () => false,
      );
      if (up) return;
      await sleep(500);
    }
    throw new Error(`Server on ${this.port} did not start: see server-${this.port}.log`);
  }

  async login(profile) {
    if (this.cookies.has(profile)) return this.cookies.get(profile);
    const res = await fetch(`${this.base}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: this.origin },
      body: JSON.stringify({ email: `${profile}@perf.local`, password: "perf-password-123456" }),
    });
    if (!res.ok) throw new Error(`Sign-in of ${profile} failed: ${res.status}`);
    const cookie = res.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    this.cookies.set(profile, cookie);
    return cookie;
  }

  // Event-loop delay max and RSS peak since the previous call.
  async stats() {
    const lines = () => fs.readFileSync(this.statsFile, "utf8").trim().split("\n").filter(Boolean);
    const before = lines().length;
    this.proc.kill("SIGUSR2");
    for (let i = 0; i < 100 && lines().length === before; i++) await sleep(20);
    return JSON.parse(lines().at(-1));
  }

  async flows() {
    if (this.worker) return this.worker;
    const script = path.join(this.dir, "scripts/perf/flows.ts");
    if (!fs.existsSync(script)) return null;
    const proc = spawn(path.join(this.dir, "node_modules/.bin/tsx"), [script], {
      cwd: this.dir,
      stdio: ["pipe", "pipe", "inherit"],
      env: { ...process.env, ...PERF_ENV, NODE_ENV: "production" },
    });
    children.push(proc);
    const waiting = [];
    readline.createInterface({ input: proc.stdout }).on("line", (line) => {
      if (line.startsWith("@@perf ")) waiting.shift()?.(JSON.parse(line.slice(7)));
    });
    const call = (msg) =>
      new Promise((resolve, reject) => {
        waiting.push((reply) => (reply.error ? reject(new Error(reply.error)) : resolve(reply)));
        if (msg) proc.stdin.write(JSON.stringify(msg) + "\n");
      });
    await call(null);
    const { flows } = await call({ cmd: "list" });
    this.worker = { proc, call, flows: new Set(flows) };
    return this.worker;
  }

  stop() {
    this.proc?.kill("SIGINT");
    this.worker?.proc.stdin.end();
  }
}

async function request(ctx, { method = "GET", url, headers = {}, body }) {
  const t = performance.now();
  const res = await fetch(ctx.build.base + url, {
    method,
    body,
    redirect: "manual",
    headers: { cookie: ctx.cookie, origin: ctx.build.origin, ...headers },
  });
  const buf = Buffer.from(await res.arrayBuffer());
  const ms = performance.now() - t;
  if (res.status !== 200) throw new Error(`${method} ${url} answered ${res.status}`);
  return { ms, buf };
}

async function measureOnce(scenario, ctx) {
  switch (scenario.kind) {
    case "page":
      return { ms: (await request(ctx, { url: scenario.path(ctx.ids) })).ms };
    case "route": {
      const cron = { authorization: `Bearer ${PERF_ENV.CRON_SECRET}` };
      const headers = scenario.url.startsWith("/api/cron") ? cron : {};
      return {
        ms: (await request(ctx, { method: scenario.method, url: scenario.url, headers })).ms,
      };
    }
    case "flow": {
      const worker = await ctx.build.flows();
      await worker.call({ cmd: "setup", flow: scenario.name, profile: ctx.profile });
      return worker.call({ cmd: "run", flow: scenario.name, profile: ctx.profile });
    }
    default: {
      const prepared = await scenario.prepare?.(ctx);
      const { ms, state } = await scenario.measure(ctx, prepared);
      await scenario.cleanup?.(ctx, state);
      return { ms };
    }
  }
}

// Questions counts every statement the server receives, the counter read included.
async function questions(sql) {
  const [row] = await sql.query("SHOW GLOBAL STATUS LIKE 'Questions'");
  return Number(row.Value);
}
async function countQueries(scenario, ctx) {
  if (scenario.kind === "flow") {
    const worker = await ctx.build.flows();
    await worker.call({ cmd: "setup", flow: scenario.name, profile: ctx.profile });
  }
  const prepared = scenario.kind === "custom" ? await scenario.prepare?.(ctx) : undefined;
  const q0 = await questions(ctx.sql);
  let state;
  if (scenario.kind === "flow") {
    await (await ctx.build.flows()).call({ cmd: "run", flow: scenario.name, profile: ctx.profile });
  } else if (scenario.kind === "custom") {
    state = (await scenario.measure(ctx, prepared)).state;
  } else {
    await measureOnce(scenario, ctx);
  }
  const q1 = await questions(ctx.sql);
  const q2 = await questions(ctx.sql);
  if (scenario.kind === "custom") await scenario.cleanup?.(ctx, state);
  return q1 - q0 - (q2 - q1);
}

// Bytes a browser downloads for a page: HTML, its inline RSC payload and its scripts.
async function pageSizes(scenario, ctx) {
  const html = (await request(ctx, { url: scenario.path(ctx.ids) })).buf.toString();
  const rsc = [...html.matchAll(/self\.__next_f\.push\((.*?)\)<\/script>/gs)];
  let js = 0;
  let jsGz = 0;
  for (const [, src] of html.matchAll(/<script src="([^"]+\.js[^"]*)"/g)) {
    if (!ctx.build.assets.has(src)) {
      const buf = Buffer.from(await (await fetch(ctx.build.base + src)).arrayBuffer());
      ctx.build.assets.set(src, { raw: buf.length, gz: gzipSync(buf).length });
    }
    js += ctx.build.assets.get(src).raw;
    jsGz += ctx.build.assets.get(src).gz;
  }
  const kb = (n) => Math.round(n / 1024);
  return {
    htmlKb: kb(html.length),
    rscKb: kb(rsc.reduce((s, m) => s + m[1].length, 0)),
    jsKb: kb(js),
    jsGzKb: kb(jsGz),
  };
}

function summarize(samples) {
  const s = [...samples].sort((a, b) => a - b);
  const at = (p) => s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  const sd = Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / s.length);
  return { p50: at(50), p95: at(95), min: s[0], max: s.at(-1), mean, cv: sd / mean };
}

// ── Main ─────────────────────────────────────────────────────────────────────

const selected = SCENARIOS.filter(
  (s) =>
    (!opts.only || new RegExp(opts.only).test(s.name)) &&
    (!opts.issue || s.issues.includes(Number(opts.issue))),
).map((s) =>
  s.kind === "page" ? { ...s, path: typeof s.url === "function" ? s.url : () => s.url } : s,
);
if (selected.length === 0) throw new Error("No scenario matches --only/--issue");

const url = new URL(PERF_ENV.DATABASE_URL);
const sql = await mariadb.createConnection({
  host: url.hostname,
  port: Number(url.port),
  user: url.username,
  password: decodeURIComponent(url.password),
  database: url.pathname.slice(1),
});
const builds = buildDirs.map((d, i) => new Build(d, i));
for (const b of builds) await b.start();

async function resolveIds(profile) {
  const one = async (q, ...args) => (await sql.query(q, args))[0]?.id;
  const user = await one("SELECT id FROM User WHERE email = ?", `${profile}@perf.local`);
  if (!user) throw new Error(`No ${profile} user in budget_perf: run npm run perf:db`);
  return {
    account: await one(
      "SELECT id FROM BankAccount WHERE ownerId = ? AND name = 'Compte courant'",
      user,
    ),
    category: await one("SELECT id FROM Category WHERE userId = ? AND name = 'Courses'", user),
    budget: await one(
      "SELECT id FROM Budget WHERE userId = ? AND name = 'Budget mensuel' ORDER BY periodStart DESC LIMIT 1",
      user,
    ),
    group: await one(
      "SELECT g.id FROM `Group` g JOIN GroupMember m ON m.groupId = g.id WHERE m.userId = ? AND g.name = 'Foyer Martin'",
      user,
    ),
  };
}

const fmt = (ms) =>
  ms === undefined ? "-" : ms >= 10_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}`;
const results = [];
for (const profile of opts.profile) {
  const ids = await resolveIds(profile);
  const ctxs = [];
  for (const build of builds)
    ctxs.push({ build, profile, ids, sql, cookie: await build.login(profile) });
  console.log(
    `\n${profile} — ${WARMUP} warm-up + ${RUNS} runs${builds.length === 2 ? ", A/B alternated" : ""}`,
  );
  const head =
    builds.length === 2
      ? "A p50   B p50     Δp50   A p95   B p95  queries A→B"
      : "p50     p95    cv  queries";
  console.log(`${"scenario".padEnd(24)} ${head}  eld max  sizes`);

  for (const scenario of selected) {
    try {
      if (scenario.kind === "flow") {
        const workers = await Promise.all(builds.map((b) => b.flows()));
        if (workers.some((w) => !w?.flows.has(scenario.name))) {
          console.log(
            `${scenario.name.padEnd(24)} skipped: not in scripts/perf/flows.ts of every build`,
          );
          continue;
        }
      }
      for (let w = 0; w < WARMUP; w++) for (const ctx of ctxs) await measureOnce(scenario, ctx);
      const per = [];
      for (const ctx of ctxs) {
        per.push({
          queries: await countQueries(scenario, ctx),
          sizes: scenario.kind === "page" ? await pageSizes(scenario, ctx) : undefined,
          samples: [],
          eldMax: 0,
        });
        if (scenario.kind !== "flow") await ctx.build.stats();
      }
      for (let i = 0; i < RUNS; i++) {
        const order = i % 2 ? [...ctxs.keys()].reverse() : [...ctxs.keys()];
        for (const k of order) {
          const r = await measureOnce(scenario, ctxs[k]);
          per[k].samples.push(r.ms);
          if (r.eldMax !== undefined) per[k].eldMax = Math.max(per[k].eldMax, r.eldMax);
        }
      }
      for (const [k, ctx] of ctxs.entries()) {
        Object.assign(per[k], summarize(per[k].samples));
        if (scenario.kind !== "flow") {
          const s = await ctx.build.stats();
          Object.assign(per[k], { eldMax: s.eldMax, peakRssMb: s.peakRssMb });
        }
      }
      results.push({ profile, scenario: scenario.name, issues: scenario.issues, builds: per });

      const [a, b] = per;
      const eld = per.map((p) => fmt(p.eldMax)).join("/");
      const sizes = per
        .filter((p) => p.sizes)
        .map(
          (p) =>
            `html ${p.sizes.htmlKb} rsc ${p.sizes.rscKb} js ${p.sizes.jsKb} (${p.sizes.jsGzKb} gz) KB`,
        )
        .join(" → ");
      const cols = b
        ? `${fmt(a.p50).padStart(6)} ${fmt(b.p50).padStart(7)} ${`${(((b.p50 - a.p50) / a.p50) * 100).toFixed(0)}%`.padStart(7)} ${fmt(a.p95).padStart(7)} ${fmt(b.p95).padStart(7)}  ${`${a.queries}→${b.queries}`.padStart(11)}`
        : `${fmt(a.p50).padStart(6)} ${fmt(a.p95).padStart(7)} ${`${Math.round(a.cv * 100)}%`.padStart(5)} ${String(a.queries).padStart(8)}`;
      console.log(`${scenario.name.padEnd(24)} ${cols}  ${eld.padStart(7)}  ${sizes}`);
    } catch (e) {
      console.log(`${scenario.name.padEnd(24)} error: ${e.message}`);
    }
  }
}

const file = path.join(
  PERF_DIR,
  "results",
  `${new Date().toISOString().replace(/[:.]/g, "-")}${opts.label ? `-${opts.label}` : ""}.json`,
);
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(
  file,
  JSON.stringify(
    {
      date: new Date().toISOString(),
      label: opts.label ?? null,
      machine: {
        cpu: os.cpus()[0]?.model,
        cores: os.cpus().length,
        memGb: Math.round(os.totalmem() / 2 ** 30),
        node: process.version,
      },
      builds: builds.map((b) => ({ name: b.name, dir: b.dir })),
      runs: RUNS,
      warmup: WARMUP,
      results,
    },
    null,
    1,
  ),
);
console.log(`\nResults: ${file}`);
for (const b of builds) b.stop();
await sql.end();
process.exit(0);
