import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  output: "standalone",
  // pdf-parse/pdfjs-dist load a worker file from their package dir at runtime;
  // bundling them breaks the worker resolution ("Setting up fake worker failed").
  // Keep them external so they are required from node_modules instead.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
};

export default withNextIntl(nextConfig);
