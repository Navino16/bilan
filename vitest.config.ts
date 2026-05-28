import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: "node",
    passWithNoTests: true,
    setupFiles: ["tests/setup.ts"],
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    reporters: ["default", ["junit", { outputFile: ".reports/junit.xml" }]],
    coverage: {
      provider: "v8",
      reporter: ["text", "cobertura"],
      reportsDirectory: ".reports/coverage",
    },
  },
});
