import {
  authorizationServerMetadata,
  serveDiscovery,
  type DiscoveryParams,
} from "@/server/mcp/discovery";

export const dynamic = "force-dynamic";

export const GET = (req: Request, ctx: DiscoveryParams) =>
  serveDiscovery(ctx, "/api/auth", authorizationServerMetadata);
