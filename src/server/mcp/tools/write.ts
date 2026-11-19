import type { z } from "zod";
import type { ToolAnnotations } from "@modelcontextprotocol/server";
import type { McpTool } from "@/server/mcp/tools/read";

export function writeTool<S extends z.ZodObject>(def: {
  name: string;
  description: string;
  input: S;
  annotations?: Partial<ToolAnnotations>;
  run: (userId: string, args: z.infer<S>) => Promise<Record<string, unknown>>;
}): McpTool {
  return {
    name: def.name,
    description: def.description,
    input: def.input,
    scope: "bilan:write",
    annotations: { readOnlyHint: false, openWorldHint: false, ...def.annotations },
    categoryPaths: false,
    run: (userId, args) => def.run(userId, args as z.infer<S>),
  };
}

export const WRITE_TOOLS: McpTool[] = [];
