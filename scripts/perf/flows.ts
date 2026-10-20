// Service-level flows of the performance benchmark, driven by scripts/perf/bench.mjs over stdin/stdout.
// They are only reachable through server actions, so they run here against the build's own sources.
import readline from "node:readline";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { db } from "@/server/db";
import { previewRulesApplication } from "@/server/services/categorization/apply";
import { exportRules } from "@/server/services/categorization/rules-export";
import {
  commitRulesImport,
  previewRulesImport,
} from "@/server/services/categorization/rules-import";
import type { ImportDecisions } from "@/lib/rules-import";
import { suggestPairs } from "@/server/services/links";

type Ctx = { userId: string; partnerId: string; ruleIds: string[]; rulesFile: string };
type Flow = {
  setup?: (c: Ctx) => Promise<unknown>;
  run: (c: Ctx, state: unknown) => Promise<unknown>;
};

const own = { groupId: null };

async function clearPartnerRules(c: Ctx): Promise<void> {
  await db.categorizationRule.deleteMany({ where: { userId: c.partnerId } });
}

const FLOWS: Record<string, Flow> = {
  "reclassify-preview-all": { run: (c) => previewRulesApplication(c.ruleIds, { id: c.userId }) },
  "reclassify-preview-one": {
    run: (c) => previewRulesApplication(c.ruleIds.slice(0, 1), { id: c.userId }),
  },
  "link-suggestions": { run: (c) => suggestPairs(c.userId) },
  "rules-import-preview": {
    setup: clearPartnerRules,
    run: (c) => previewRulesImport(c.rulesFile, own, { id: c.partnerId }),
  },
  // The first commit creates the partner's missing categories; the warm-up runs absorb it.
  "rules-import-commit": {
    setup: async (c): Promise<ImportDecisions> => {
      await clearPartnerRules(c);
      const preview = await previewRulesImport(c.rulesFile, own, { id: c.partnerId });
      const missing = preview.resolutions.filter((r) => !r.categoryId);
      return {
        categories: Object.fromEntries(missing.map((r) => [r.key, { action: "create" }])),
        moves: [],
      };
    },
    run: (c, decisions) =>
      commitRulesImport(c.rulesFile, own, decisions as ImportDecisions, { id: c.partnerId }),
  },
};

const contexts = new Map<string, Ctx>();
async function context(profile: string): Promise<Ctx> {
  const cached = contexts.get(profile);
  if (cached) return cached;
  const user = await db.user.findUniqueOrThrow({ where: { email: `${profile}@perf.local` } });
  const partner = await db.user.findUniqueOrThrow({
    where: { email: `${profile}-partner@perf.local` },
  });
  const rules = await db.categorizationRule.findMany({
    where: { userId: user.id, enabled: true },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  const file = await exportRules(own, { id: user.id });
  const ctx = {
    userId: user.id,
    partnerId: partner.id,
    ruleIds: rules.map((r) => r.id),
    rulesFile: JSON.stringify(file),
  };
  contexts.set(profile, ctx);
  return ctx;
}

function reply(msg: object): void {
  process.stdout.write(`@@perf ${JSON.stringify(msg)}\n`);
}
const states = new Map<string, unknown>();

async function handle(line: string): Promise<void> {
  const {
    cmd,
    flow: name,
    profile,
  } = JSON.parse(line) as {
    cmd: "list" | "setup" | "run";
    flow: string;
    profile: string;
  };
  if (cmd === "list") return reply({ flows: Object.keys(FLOWS) });
  const flow = FLOWS[name];
  if (!flow) throw new Error(`Unknown flow: ${name}`);
  const ctx = await context(profile);
  if (cmd === "setup") {
    states.set(name, await flow.setup?.(ctx));
    return reply({});
  }
  const eld = monitorEventLoopDelay({ resolution: 10 });
  eld.enable();
  const t = performance.now();
  await flow.run(ctx, states.get(name));
  const ms = performance.now() - t;
  eld.disable();
  reply({ ms, eldMax: eld.max / 1e6 });
}

const lines = readline.createInterface({ input: process.stdin });
let queue = Promise.resolve();
lines.on("line", (line) => {
  queue = queue.then(() =>
    handle(line).catch((e: unknown) =>
      reply({ error: e instanceof Error ? e.message : String(e) }),
    ),
  );
});
lines.on("close", () => {
  void queue.then(async () => {
    await db.$disconnect();
    process.exit(0);
  });
});
reply({ ready: true });
