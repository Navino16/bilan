import type { CategorizationRule } from "@prisma/client";
import { db } from "@/server/db";
import { LONG_TX_TIMEOUT } from "@/server/db/timeouts";
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
import { mapInSlices } from "./cooperative";

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
    plans.push(...(await mapInSlices(rows, (slice) => planPreparedApplication(prepared, slice))));
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

// Writes are grouped by target category, so a category several rules point at is one chunked
// updateMany. The manual guard can skip rows (made manual since the plan); only then is the chunk
// re-read to attribute the moved rows to their rules for the hits and the `rule.applied` counts.
async function applyFrom(
  manageable: CategorizationRule[],
  actor: { id: string },
): Promise<{ reclassified: number }> {
  const plan = await planFor(manageable, actor);
  const byCategory = new Map<string, { id: string; ruleId: string }[]>();
  for (const m of plan.moves) {
    const rows = byCategory.get(m.categoryId) ?? [];
    rows.push({ id: m.id, ruleId: m.ruleId });
    byCategory.set(m.categoryId, rows);
  }
  const movedRuleIds = await db.$transaction(async (tx) => {
    const moved: string[] = [];
    for (const [categoryId, rows] of byCategory) {
      for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
        const chunk = rows.slice(i, i + WRITE_CHUNK);
        const ids = chunk.map((r) => r.id);
        const { count } = await tx.transaction.updateMany({
          where: { id: { in: ids }, manuallyCategorized: false },
          data: { categoryId },
        });
        let done = chunk;
        if (count < chunk.length) {
          const still = await tx.transaction.findMany({
            where: { id: { in: ids }, categoryId, manuallyCategorized: false },
            select: { id: true },
          });
          const ok = new Set(still.map((r) => r.id));
          done = chunk.filter((r) => ok.has(r.id));
        }
        for (const r of done) moved.push(r.ruleId);
      }
    }
    await recordHits(moved, tx);
    return moved;
  }, LONG_TX_TIMEOUT);
  const counts = new Map<string, number>();
  for (const ruleId of movedRuleIds) counts.set(ruleId, (counts.get(ruleId) ?? 0) + 1);
  for (const [ruleId, count] of counts) {
    await logEvent({
      userId: actor.id,
      action: "rule.applied",
      entity: "CategorizationRule",
      entityId: ruleId,
      metadata: { reclassified: count },
    });
  }
  return { reclassified: movedRuleIds.length };
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
