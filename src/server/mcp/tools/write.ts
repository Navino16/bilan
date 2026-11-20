import type { McpTool } from "@/server/mcp/tools/read";
import { ACCOUNT_WRITE_TOOLS } from "@/server/mcp/tools/write-accounts";
import { BUDGET_WRITE_TOOLS } from "@/server/mcp/tools/write-budgets";
import { CATEGORY_WRITE_TOOLS } from "@/server/mcp/tools/write-categories";
import { LINK_WRITE_TOOLS } from "@/server/mcp/tools/write-links";
import { RULE_WRITE_TOOLS } from "@/server/mcp/tools/write-rules";
import { SETTINGS_WRITE_TOOLS } from "@/server/mcp/tools/write-settings";
import { TRANSACTION_WRITE_TOOLS } from "@/server/mcp/tools/write-transactions";

export { writeTool } from "@/server/mcp/tools/write-tool";

export const WRITE_TOOLS: McpTool[] = [
  ...TRANSACTION_WRITE_TOOLS,
  ...LINK_WRITE_TOOLS,
  ...BUDGET_WRITE_TOOLS,
  ...CATEGORY_WRITE_TOOLS,
  ...RULE_WRITE_TOOLS,
  ...SETTINGS_WRITE_TOOLS,
  ...ACCOUNT_WRITE_TOOLS,
];
