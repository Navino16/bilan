import {
  protectedResourceMetadata,
  discoveryPreflight,
  serveDiscovery,
  type DiscoveryParams,
} from "@/server/mcp/discovery";
import { getAppName } from "@/server/services/settings/app-settings";

export const dynamic = "force-dynamic";

export const GET = (req: Request, ctx: DiscoveryParams) =>
  serveDiscovery(ctx, "/api/mcp", async () => protectedResourceMetadata(await getAppName()));

export const OPTIONS = discoveryPreflight;
