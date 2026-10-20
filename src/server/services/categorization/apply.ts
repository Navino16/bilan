import type { CategorizationRule } from "@prisma/client";
import { db } from "@/server/db";
import { decrypt } from "@/server/crypto/encryption";
import { dataKey } from "@/server/crypto/keys";
import { logEvent } from "@/server/services/audit";
import { writableAccountIds } from "@/server/services/accounts/sharing";
import {
  assertRuleCategory,
  loadManageableRule,
  loadManageableRules,
  loadRules,
  recordHits,
  RuleValidationError,
} from "./index";
import {
  mergePlans,
  planPreparedApplication,
  prepareApplication,
  type RuleApplicationPlan,
} from "./apply-plan";

export type RuleApplicationPreview = Omit<RuleApplicationPlan, "moves"> & { moving: number };

const PAGE = 1000;
const WRITE_CHUNK = 500;

// Labels are encrypted at rest, so matching decrypts every row of the actor's writable accounts.
// Disabled rules are dropped: only the enabled ones take part in the winner computation (#291).
async function planFor(manageable: CategorizationRule[], actor: { id: string }) {
  const enabled = manageable.filter((r) => r.enabled);
  // A rule can outlive the actor's access to its category (e.g. after leaving a household).
  for (const categoryId of new Set(enabled.map((r) => r.categoryId))) {
    await assertRuleCategory(categoryId, actor.id);
  }
  const rules = await loadRules({ userId: actor.id });
  const ids = new Set(enabled.map((r) => r.id));
  const applied = rules.filter((r) => ids.has(r.id));
  const plans: RuleApplicationPlan[] = [];
  if (applied.length === 0) return mergePlans(plans);
  const accountIds = await writableAccountIds(actor.id);
  const prepared = prepareApplication(applied, rules);

  let cursor: string | undefined;
  for (;;) {
    const page = await db.transaction.findMany({
      where: { accountId: { in: accountIds } },
      select: { id: true, rawLabelEnc: true, categoryId: true, manuallyCategorized: true },
      orderBy: { id: "asc" },
      take: PAGE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const rows = page.map((t) => ({
      id: t.id,
      rawLabel: decrypt(t.rawLabelEnc, dataKey),
      categoryId: t.categoryId,
      manual: t.manuallyCategorized,
    }));
    plans.push(planPreparedApplication(prepared, rows));
    if (page.length < PAGE) break;
    cursor = page[page.length - 1].id;
  }
  return mergePlans(plans);
}

async function previewFrom(manageable: CategorizationRule[], actor: { id: string }) {
  const plan = await planFor(manageable, actor);
  const { moves, ...counts } = plan;
  return { ...counts, moving: moves.length };
}

async function applyFrom(
  manageable: CategorizationRule[],
  actor: { id: string },
): Promise<{ reclassified: number }> {
  const plan = await planFor(manageable, actor);
  const byRule = new Map<string, { categoryId: string; ids: string[] }>();
  for (const m of plan.moves) {
    const entry = byRule.get(m.ruleId) ?? { categoryId: m.categoryId, ids: [] };
    entry.ids.push(m.id);
    byRule.set(m.ruleId, entry);
  }
  const counts = await db.$transaction(async (tx) => {
    const done = new Map<string, number>();
    for (const [ruleId, { categoryId, ids }] of byRule) {
      let count = 0;
      for (let i = 0; i < ids.length; i += WRITE_CHUNK) {
        // A row made manual since the plan was computed must stay as the user set it.
        const res = await tx.transaction.updateMany({
          where: { id: { in: ids.slice(i, i + WRITE_CHUNK) }, manuallyCategorized: false },
          data: { categoryId },
        });
        count += res.count;
      }
      if (count > 0) {
        await recordHits(Array<string>(count).fill(ruleId), tx);
        done.set(ruleId, count);
      }
    }
    return done;
  });
  let reclassified = 0;
  for (const [ruleId, count] of counts) {
    reclassified += count;
    await logEvent({
      userId: actor.id,
      action: "rule.applied",
      entity: "CategorizationRule",
      entityId: ruleId,
      metadata: { reclassified: count },
    });
  }
  return { reclassified };
}

async function loadEnabledRule(ruleId: string, actor: { id: string }) {
  const rule = await loadManageableRule(ruleId, actor.id);
  if (!rule.enabled) throw new RuleValidationError("DISABLED");
  return rule;
}

export async function previewRulesApplication(
  ruleIds: string[],
  actor: { id: string },
): Promise<RuleApplicationPreview> {
  return previewFrom(await loadManageableRules(ruleIds, actor.id), actor);
}

export async function applyRules(
  ruleIds: string[],
  actor: { id: string },
): Promise<{ reclassified: number }> {
  return applyFrom(await loadManageableRules(ruleIds, actor.id), actor);
}

export async function previewRuleApplication(
  ruleId: string,
  actor: { id: string },
): Promise<RuleApplicationPreview> {
  return previewFrom([await loadEnabledRule(ruleId, actor)], actor);
}

export async function applyRule(
  ruleId: string,
  actor: { id: string },
): Promise<{ reclassified: number }> {
  return applyFrom([await loadEnabledRule(ruleId, actor)], actor);
}
