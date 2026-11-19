import { McpServer } from "@modelcontextprotocol/server";
import type { CallToolResult, StandardSchemaWithJSON } from "@modelcontextprotocol/server";
import type { z } from "zod";
import { mcpWriteLimiter } from "@/server/auth/rate-limit";
import { mcpLimiterKey, runAsMcp, type McpPrincipal, type McpScope } from "@/server/mcp/context";
import { toolErrorCode, type ToolErrorCode } from "@/server/mcp/errors";
import { serialize } from "@/server/mcp/serialize";
import {
  READ_TOOLS,
  UNTRUSTED_NOTE,
  loadCategoryPaths,
  type McpTool,
} from "@/server/mcp/tools/read";
import { WRITE_TOOLS } from "@/server/mcp/tools/write";

export const hasScope = (principal: Pick<McpPrincipal, "scopes">, scope: McpScope) =>
  principal.scopes.includes(scope) ||
  (scope === "bilan:read" && principal.scopes.includes("bilan:write"));

// Advertises the zod schema but accepts any arguments: the SDK would answer a schema
// mismatch with its own message, the handler answers INVALID_INPUT instead.
function advertised(schema: z.ZodObject): StandardSchemaWithJSON {
  const std = schema["~standard"];
  return { "~standard": { ...std, validate: (value: unknown) => ({ value }) } };
}

// `detail` only ever describes the caller's own arguments (zod issues), never server state.
const toolError = (code: ToolErrorCode, detail?: string): CallToolResult => ({
  isError: true,
  content: [
    { type: "text", text: code },
    ...(detail ? [{ type: "text" as const, text: detail }] : []),
  ],
});

const describeIssues = (error: z.ZodError) =>
  error.issues.map((i) => `${i.path.join(".") || "arguments"}: ${i.message}`).join("; ");

async function runTool(
  principal: McpPrincipal,
  tool: McpTool,
  args: unknown,
): Promise<CallToolResult> {
  const parsed = tool.input.safeParse(args ?? {});
  if (!parsed.success) return toolError("INVALID_INPUT", describeIssues(parsed.error));
  if (tool.scope === "bilan:write" && !mcpWriteLimiter.consume(mcpLimiterKey(principal)).allowed) {
    return toolError("RATE_LIMITED");
  }
  try {
    const structuredContent = await runAsMcp(principal, async () => {
      const [result, categoryPaths] = await Promise.all([
        tool.run(principal.userId, parsed.data),
        tool.categoryPaths ? loadCategoryPaths(principal.userId) : undefined,
      ]);
      return serialize(result, { categoryPaths }) as Record<string, unknown>;
    });
    return {
      structuredContent,
      content: [{ type: "text", text: JSON.stringify(structuredContent) }],
    };
  } catch (e) {
    return toolError(toolErrorCode(e));
  }
}

// One server per authenticated request: only the tools the principal's scopes allow.
export function buildMcpServer(
  principal: McpPrincipal,
  tools: McpTool[] = [...READ_TOOLS, ...WRITE_TOOLS],
): McpServer {
  const server = new McpServer({ name: "bilan", version: "1.0.0" });
  for (const tool of tools) {
    if (!hasScope(principal, tool.scope)) continue;
    server.registerTool(
      tool.name,
      {
        description: `${tool.description} ${UNTRUSTED_NOTE}`,
        inputSchema: advertised(tool.input),
        annotations: tool.annotations,
      },
      (args: unknown) => runTool(principal, tool, args),
    );
  }
  return server;
}
