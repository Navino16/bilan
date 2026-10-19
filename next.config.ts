import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { API_SECURITY_HEADERS } from "./src/lib/security-headers";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  output: "standalone",
  // Enables forbidden()/unauthorized() interrupts → forbidden.tsx / unauthorized.tsx
  // with real 403/401 statuses (scope 8.6).
  experimental: { authInterrupts: true },
  // pdfjs-dist loads a worker file from its package dir at runtime;
  // bundling it breaks the worker resolution ("Setting up fake worker failed").
  // Keep it external so it is required from node_modules instead.
  serverExternalPackages: ["pdfjs-dist"],
  // Dev only: reach the dev server from private-network addresses (WSL IP, phone on the LAN).
  allowedDevOrigins: ["10.*.*.*", "172.*.*.*", "192.168.*.*"],
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: Object.entries(API_SECURITY_HEADERS).map(([key, value]) => ({ key, value })),
      },
    ];
  },
};

export default withNextIntl(nextConfig);
