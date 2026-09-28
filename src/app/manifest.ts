import type { MetadataRoute } from "next";
import { getAppName } from "@/server/services/settings/app-settings";

export const dynamic = "force-dynamic";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const appName = await getAppName();
  return {
    name: appName,
    short_name: appName,
    description: "Self-hosted multi-user personal finance app",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f7f4ed",
    theme_color: "#1f4d3a",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
