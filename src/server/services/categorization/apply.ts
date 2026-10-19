import { db } from "@/server/db";
import { decrypt } from "@/server/crypto/encryption";
import { dataKey } from "@/server/crypto/keys";
import { logEvent } from "@/server/services/audit";
import { writableAccountIds } from "@/server/services/accounts/sharing";
import {
  loadManageableRule,
  loadRules,
  recordHits,
  RuleAccessError,
  RuleValidationError,
} from "./index";
import { planRuleApplication, type PlanRow, type RuleApplicationPlan } from "./apply-plan";

export type RuleApplicationPreview = Omit<RuleApplicationPlan, "moveIds"> & { moving: number };

const PAGE = 1000;
const WRITE_CHUNK = 500;

// Labels are encrypted at rest, so matching decrypts every row of the actor's writable accounts.
async function planFor(ruleId: string, actor: { id: string }) {
  const rule = await loadManageableRule(ruleId, actor.id);
  if (!rule.enabled) throw new RuleValidationError("DISABLED");
  const rules = await loadRules({ userId: actor.id });
  const applied = rules.find((r) => r.id === ruleId);
  if (!applied) throw new RuleAccessError("NOT_FOUND");
  const accountIds = await writableAccountIds(actor.id);

  const rows: PlanRow[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await db.transaction.findMany({
      where: { accountId: { in: accountIds } },
      select: { id: true, rawLabelEnc: true, categoryId: true, manuallyCategorized: true },
      orderBy: { id: "asc" },
      take: PAGE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    for (const t of page) {
      rows.push({
        id: t.id,
        rawLabel: decrypt(t.rawLabelEnc, dataKey),
        categoryId: t.categoryId,
        manual: t.manuallyCategorized,
      });
    }
    if (page.length < PAGE) break;
    cursor = page[page.length - 1].id;
  }
  return { applied, plan: planRuleApplication(applied, rules, rows) };
}

export async function previewRuleApplication(
  ruleId: string,
  actor: { id: string },
): Promise<RuleApplicationPreview> {
  const { plan } = await planFor(ruleId, actor);
  const { moveIds, ...counts } = plan;
  return { ...counts, moving: moveIds.length };
}

export async function applyRule(
  ruleId: string,
  actor: { id: string },
): Promise<{ reclassified: number }> {
  const { applied, plan } = await planFor(ruleId, actor);
  const reclassified = await db.$transaction(async (tx) => {
    let count = 0;
    for (let i = 0; i < plan.moveIds.length; i += WRITE_CHUNK) {
      // A row made manual since the plan was computed must stay as the user set it.
      const res = await tx.transaction.updateMany({
        where: { id: { in: plan.moveIds.slice(i, i + WRITE_CHUNK) }, manuallyCategorized: false },
        data: { categoryId: applied.categoryId },
      });
      count += res.count;
    }
    if (count > 0) await recordHits(Array<string>(count).fill(ruleId), tx);
    return count;
  });
  if (reclassified > 0) {
    await logEvent({
      userId: actor.id,
      action: "rule.applied",
      entity: "CategorizationRule",
      entityId: ruleId,
      metadata: { reclassified },
    });
  }
  return { reclassified };
}
