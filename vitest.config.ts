import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: "node",
    passWithNoTests: true,
    setupFiles: ["tests/setup.ts"],
    // Integration tests share a single MariaDB test database, so test files
    // must not run concurrently (e.g. a transient OIDC AuthProvider row from
    // one file would otherwise bleed into another file's getAuth() build).
    fileParallelism: false,
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    reporters: ["default", ["junit", { outputFile: ".reports/junit.xml" }]],
    coverage: {
      provider: "v8",
      reporter: ["text", "cobertura"],
      reportsDirectory: ".reports/coverage",
    },
  },
});
