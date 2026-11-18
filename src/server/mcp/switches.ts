import { appSettings } from "@/server/services/settings/app-settings";

export async function isMcpInstanceEnabled(): Promise<boolean> {
  return (await appSettings.get<boolean>("mcp_enabled")) ?? false;
}
