import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { providerCache } from "@/server/auth/providers";
import {
  createAuthProvider,
  deleteAuthProvider,
  updateAuthProvider,
} from "@/server/services/settings/auth-providers";

const adminId = "admin_hot_reload";

beforeAll(async () => {
  await db.userRole.deleteMany();
  await db.user.deleteMany({ where: { id: adminId } });
  await db.user.create({ data: { id: adminId, email: `admin+${Date.now()}@b.l` } });
  await db.authProvider.deleteMany({ where: { key: "test-oidc" } });
});

afterAll(async () => {
  await db.user.deleteMany({ where: { id: adminId } });
  await db.authProvider.deleteMany({ where: { key: "test-oidc" } });
  await db.$disconnect();
});

describe("AuthProvider hot reload", () => {
  it("invalidates the cache when a provider is created", async () => {
    // Prime the cache (empty)
    const before = await providerCache.get();
    expect(before.find((p) => p.key === "test-oidc")).toBeUndefined();

    await createAuthProvider(
      {
        key: "test-oidc",
        type: "oidc",
        displayName: "Test OIDC",
        enabled: true,
        issuer: "https://idp.example.com",
        clientId: "client_xyz",
        clientSecret: "secret_value",
        scopes: "openid,email",
      },
      { id: adminId },
    );

    const after = await providerCache.get();
    expect(after.find((p) => p.key === "test-oidc")).toBeDefined();
  });

  it("invalidates the cache when a provider is disabled", async () => {
    expect((await providerCache.get()).find((p) => p.key === "test-oidc")).toBeDefined();
    await updateAuthProvider(
      {
        key: "test-oidc",
        type: "oidc",
        displayName: "Test OIDC",
        enabled: false,
        issuer: "https://idp.example.com",
        clientId: "client_xyz",
      },
      { id: adminId },
    );
    expect((await providerCache.get()).find((p) => p.key === "test-oidc")).toBeUndefined();
  });

  it("invalidates the cache when a provider is deleted", async () => {
    await updateAuthProvider(
      {
        key: "test-oidc",
        type: "oidc",
        displayName: "Test OIDC",
        enabled: true,
        issuer: "https://idp.example.com",
        clientId: "client_xyz",
      },
      { id: adminId },
    );
    expect((await providerCache.get()).find((p) => p.key === "test-oidc")).toBeDefined();
    await deleteAuthProvider("test-oidc", { id: adminId });
    expect((await providerCache.get()).find((p) => p.key === "test-oidc")).toBeUndefined();
  });
});
