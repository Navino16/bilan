import type { McpTool } from "@/server/mcp/tools/read";
import { BUDGET_WRITE_TOOLS } from "@/server/mcp/tools/write-budgets";
import { CATEGORY_WRITE_TOOLS } from "@/server/mcp/tools/write-categories";
import { LINK_WRITE_TOOLS } from "@/server/mcp/tools/write-links";
import { RULE_WRITE_TOOLS } from "@/server/mcp/tools/write-rules";
import { TRANSACTION_WRITE_TOOLS } from "@/server/mcp/tools/write-transactions";

export { writeTool } from "@/server/mcp/tools/write-tool";

export const WRITE_TOOLS: McpTool[] = [
  ...TRANSACTION_WRITE_TOOLS,
  ...LINK_WRITE_TOOLS,
  ...BUDGET_WRITE_TOOLS,
  ...CATEGORY_WRITE_TOOLS,
  ...RULE_WRITE_TOOLS,
];
