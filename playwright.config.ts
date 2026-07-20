import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ["list"],
    ["junit", { outputFile: ".reports/junit-e2e.xml" }],
    ["html", { outputFolder: ".reports/playwright-report", open: "never" }],
  ],
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    // The app registers a PWA service worker in production; block it in tests so
    // its app-shell cache can't serve stale pages between navigations.
    serviceWorkers: "block",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, dependencies: ["setup"] },
    { name: "mobile", use: { ...devices["iPhone 14"] }, dependencies: ["setup"] },
  ],
  webServer: {
    // In CI, serve a production build: `next dev` (Turbopack) compiles routes
    // on demand and its compiler hangs under the full-suite load on the runner
    // (static assets keep serving, but any route needing compilation times out).
    // `next start` pre-compiles everything → stable. Locally we reuse the running
    // dev server for fast iteration.
    command: process.env.CI ? "npm run start" : "npm run dev",
    port: 3000,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
