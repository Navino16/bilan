// Injects valid bootstrap env vars for tests that import modules consuming `env`
// (e.g. `src/server/db`). Real values come from the shell when needed
// (DATABASE_URL is overridden per-test-command for integration tests).
process.env.APP_URL ??= "http://localhost:3000";
process.env.AUTH_SECRET ??= "x".repeat(32);
process.env.DATA_ENCRYPTION_KEY ??= Buffer.alloc(32, 1).toString("base64");
process.env.SEARCH_TOKEN_KEY ??= Buffer.alloc(32, 2).toString("base64");
// Default to mariadb-test (port 3307); integration tests use this DB.
process.env.DATABASE_URL ??= "mysql://app:app_password@localhost:3307/budget_test";
