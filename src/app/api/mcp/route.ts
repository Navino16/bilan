import { handleMcpRequest } from "@/server/mcp/http";

export const runtime = "nodejs";

export { handleMcpRequest as GET, handleMcpRequest as POST, handleMcpRequest as DELETE };
