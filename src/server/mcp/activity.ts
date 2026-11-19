import { db } from "@/server/db";

export const MCP_ACTIVITY_DAYS = 90;
export const MCP_ACTIVITY_LIMIT = 50;

export type McpActivityRow = {
  id: string;
  at: Date;
  clientName: string;
  action: string;
  entity: string | null;
  entityId: string | null;
};

function clientName(metadata: unknown): string {
  const client = (metadata as { client?: { name?: unknown; id?: unknown } } | null)?.client;
  if (typeof client?.name === "string") return client.name;
  return typeof client?.id === "string" ? client.id : "";
}

// The user's writes through an AI assistant, stamped by `logEvent` inside `runAsMcp`.
export async function listMcpActivity(
  userId: string,
  now: Date = new Date(),
): Promise<McpActivityRow[]> {
  const rows = await db.auditLog.findMany({
    where: {
      userId,
      createdAt: { gte: new Date(now.getTime() - MCP_ACTIVITY_DAYS * 86_400_000) },
      metadata: { path: "$.via", equals: "mcp" },
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
  return rows.map((r) => ({
    id: r.id,
    at: r.createdAt,
    clientName: clientName(r.metadata),
    action: r.action,
    entity: r.entity,
    entityId: r.entityId,
  }));
}
