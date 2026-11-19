import type { McpTool } from "@/server/mcp/tools/read";
import { LINK_WRITE_TOOLS } from "@/server/mcp/tools/write-links";
import { TRANSACTION_WRITE_TOOLS } from "@/server/mcp/tools/write-transactions";

export { writeTool } from "@/server/mcp/tools/write-tool";

export const WRITE_TOOLS: McpTool[] = [...TRANSACTION_WRITE_TOOLS, ...LINK_WRITE_TOOLS];
