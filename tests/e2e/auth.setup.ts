import { test as setup, expect } from "@playwright/test";

const USERS = [
  { file: "tests/e2e/.auth/owner.json", email: "owner@e2e.local", password: "e2e-owner-pw-123456" },
  {
    file: "tests/e2e/.auth/member.json",
    email: "member@e2e.local",
    password: "e2e-member-pw-123456",
  },
  { file: "tests/e2e/.auth/admin.json", email: "admin@e2e.local", password: "e2e-admin-pw-123456" },
  {
    file: "tests/e2e/.auth/superadmin.json",
    email: "superadmin@e2e.local",
    password: "e2e-superadmin-pw-123456",
  },
];

for (const u of USERS) {
  setup(`authenticate ${u.email}`, async ({ page }) => {
    await page.goto("/fr/login");
    await page.fill('input[name="email"]', u.email);
    await page.fill('input[name="password"]', u.password);
    await page.click('button[type="submit"]');
    // Wait for the real post-login landing page; matching `/fr` alone would also
    // match `/fr/login` and save an unauthenticated state.
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15_000 });
    await page.context().storageState({ path: u.file });
  });
}
