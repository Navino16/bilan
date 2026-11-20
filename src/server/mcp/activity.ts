import { db } from "@/server/db";
import { readableCategoryNames } from "@/server/services/categories";
import { readableBudgetNames } from "@/server/services/budgets";
import { readableRulePatterns } from "@/server/services/categorization";
import { readableTransactionLabels } from "@/server/services/transactions";

export const MCP_ACTIVITY_DAYS = 90;
export const MCP_ACTIVITY_LIMIT = 50;

export type McpActivityTarget = { text: string; href: string | null };

export type McpActivityRow = {
  id: string;
  at: Date;
  clientName: string;
  action: string;
  entity: string | null;
  entityId: string | null;
  target: McpActivityTarget | null;
};

type TargetRef =
  | { kind: "transactions"; ids: string[] }
  | { kind: "link"; linkId: string }
  | { kind: "budget"; budgetId: string; transactionId: string | null }
  | { kind: "category"; categoryId: string }
  | { kind: "rule"; ruleId: string }
  | { kind: "text"; text: string };

function clientName(metadata: unknown): string {
  const client = (metadata as { client?: { name?: unknown; id?: unknown } } | null)?.client;
  if (typeof client?.name === "string") return client.name;
  return typeof client?.id === "string" ? client.id : "";
}

function targetRef(
  entity: string | null,
  entityId: string | null,
  metadata: unknown,
): TargetRef | null {
  if (!entityId) return null;
  switch (entity) {
    case "Transaction":
      return { kind: "transactions", ids: [entityId] };
    case "IgnoredLinkSuggestion":
      return { kind: "transactions", ids: entityId.split("|") };
    case "TransactionLink": {
      const { sourceId, legId } = (metadata ?? {}) as { sourceId?: unknown; legId?: unknown };
      return typeof sourceId === "string" && typeof legId === "string"
        ? { kind: "transactions", ids: [sourceId, legId] }
        : { kind: "link", linkId: entityId };
    }
    case "Budget":
      return { kind: "budget", budgetId: entityId, transactionId: null };
    case "BudgetAssignment": {
      const [budgetId, transactionId] = entityId.split(":");
      return { kind: "budget", budgetId, transactionId: transactionId ?? null };
    }
    case "Category":
      return { kind: "category", categoryId: entityId };
    case "CategorizationRule":
      return { kind: "rule", ruleId: entityId };
    case "MerchantAlias":
      return { kind: "text", text: entityId };
    default:
      return null;
  }
}

function joinLabels(labels: string[]): string | null {
  if (labels.length === 0) return null;
  if (labels.length === 2) return `${labels[0]} ↔ ${labels[1]}`;
  return labels.length > 2 ? `${labels[0]} +${labels.length - 1}` : labels[0];
}

// What each row changed, as the user can read it now: unreadable or deleted parts are
// dropped (spec §5.18). One query per entity type for the whole page.
async function resolveTargets(
  userId: string,
  refs: (TargetRef | null)[],
): Promise<(McpActivityTarget | null)[]> {
  const linkIds = refs.flatMap((r) => (r?.kind === "link" ? [r.linkId] : []));
  const members = linkIds.length
    ? await db.transactionLinkMember.findMany({
        where: { linkId: { in: linkIds } },
        orderBy: [{ joinedAt: "asc" }, { transactionId: "asc" }],
        select: { linkId: true, transactionId: true },
      })
    : [];
  const legs = Map.groupBy(members, (m) => m.linkId);
  const txIdsOf = (r: TargetRef): string[] => {
    if (r.kind === "transactions") return r.ids;
    if (r.kind === "link") return (legs.get(r.linkId) ?? []).map((m) => m.transactionId);
    return r.kind === "budget" && r.transactionId ? [r.transactionId] : [];
  };
  const present = refs.filter((r) => r !== null);
  const [labels, budgets, categories, rules] = await Promise.all([
    readableTransactionLabels(userId, [...new Set(present.flatMap(txIdsOf))]),
    readableBudgetNames(userId, [
      ...new Set(present.flatMap((r) => (r.kind === "budget" ? [r.budgetId] : []))),
    ]),
    readableCategoryNames(userId, [
      ...new Set(present.flatMap((r) => (r.kind === "category" ? [r.categoryId] : []))),
    ]),
    readableRulePatterns(userId, [
      ...new Set(present.flatMap((r) => (r.kind === "rule" ? [r.ruleId] : []))),
    ]),
  ]);
  const labelsOf = (ids: string[]) => ids.flatMap((id) => labels.get(id) ?? []);

  return refs.map((r) => {
    if (!r) return null;
    if (r.kind === "text") return { text: r.text, href: null };
    if (r.kind === "category") {
      const name = categories.get(r.categoryId);
      return name ? { text: name, href: "/categories" } : null;
    }
    if (r.kind === "rule") {
      const pattern = rules.get(r.ruleId);
      return pattern ? { text: pattern, href: "/categories" } : null;
    }
    if (r.kind !== "budget") {
      const text = joinLabels(labelsOf(txIdsOf(r)));
      return text ? { text, href: null } : null;
    }
    const name = budgets.get(r.budgetId);
    const text = [...labelsOf(txIdsOf(r)), ...(name ? [name] : [])].join(" → ");
    return text ? { text, href: name ? `/budgets/${r.budgetId}` : null } : null;
  });
}

// The user's own writes through an AI assistant, stamped by `logEvent` inside `runAsMcp`.
export async function listMcpActivity(
  userId: string,
  now: Date = new Date(),
): Promise<McpActivityRow[]> {
  const rows = await db.auditLog.findMany({
    where: {
      userId,
      createdAt: { gte: new Date(now.getTime() - MCP_ACTIVITY_DAYS * 86_400_000) },
      AND: [
        { metadata: { path: "$.via", equals: "mcp" } },
        { metadata: { path: "$.by", equals: userId } },
      ],
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: MCP_ACTIVITY_LIMIT,
    select: {
      id: true,
      createdAt: true,
      action: true,
      entity: true,
      entityId: true,
      metadata: true,
    },
  });
  const targets = await resolveTargets(
    userId,
    rows.map((r) => targetRef(r.entity, r.entityId, r.metadata)),
  );
  return rows.map((r, i) => ({
    id: r.id,
    at: r.createdAt,
    clientName: clientName(r.metadata),
    action: r.action,
    entity: r.entity,
    entityId: r.entityId,
    target: targets[i],
  }));
}
