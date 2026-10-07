import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { appSettings } from "@/server/services/settings/app-settings";
import {
  AuthProviderError,
  authProviderImpact,
  createAuthProvider,
  deleteAuthProvider,
  providerSchema,
  updateAuthProvider,
  type ProviderInput,
} from "@/server/services/settings/auth-providers";

const stamp = Date.now();
const actor = { id: `ap_actor_${stamp}` };
const users = {
  oidcOnly: `ap_oidc_only_${stamp}`,
  password: `ap_password_${stamp}`,
  passkey: `ap_passkey_${stamp}`,
  google: `ap_google_${stamp}`,
  twoIdps: `ap_two_idps_${stamp}`,
  passwordOnly: `ap_password_only_${stamp}`,
};
const key = `ap-${stamp}`;
const keys = {
  lock: `ap-lock-${stamp}`,
  pw: `ap-pw-${stamp}`,
  pk: `ap-pk-${stamp}`,
  google: `ap-g-${stamp}`,
  main: `ap-main-${stamp}`,
  other: `ap-other-${stamp}`,
  off: `ap-off-${stamp}`,
};
const googleKeys = [`ap-google-${stamp}`, `ap-google2-${stamp}`];
const allKeys = [key, ...Object.values(keys), ...googleKeys];
const oidc: ProviderInput = {
  key,
  type: "oidc",
  displayName: "Test IdP",
  enabled: true,
  issuer: "https://idp.example.com",
  clientId: "client",
  clientSecret: "secret",
  tokenUrl: "https://idp.example.com/token",
};

let n = 0;
const link = (userId: string, providerId: string, password?: string) =>
  db.authAccount.create({
    data: {
      id: `ap_acc_${stamp}_${++n}`,
      userId,
      accountId: `sub-${stamp}-${n}`,
      providerId,
      password,
    },
  });

beforeAll(async () => {
  await db.user.createMany({
    data: [actor.id, ...Object.values(users)].map((id) => ({ id, email: `${id}@bilan.local` })),
  });
  await link(users.password, "credential", "hashed");
  await link(users.passwordOnly, "credential", "hashed");
  await db.passkey.create({
    data: {
      id: `ap_pk_${stamp}`,
      userId: users.passkey,
      publicKey: "pk",
      credentialID: `cred-${stamp}`,
      deviceType: "singleDevice",
    },
  });
});

afterAll(async () => {
  await db.authProvider.deleteMany({ where: { key: { in: allKeys } } });
  await db.auditLog.deleteMany({ where: { userId: actor.id } });
  await db.user.deleteMany({ where: { id: { in: [actor.id, ...Object.values(users)] } } });
  await db.$disconnect();
});

const errorOf = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e) => (e instanceof AuthProviderError ? { code: e.code, count: e.count } : { code: "OTHER" }),
  );
const codeOf = async (p: Promise<unknown>) => (await errorOf(p))?.code ?? null;

describe("providerSchema (#163)", () => {
  it("requires an issuer and a client ID for OIDC, a client ID for Google", () => {
    expect(providerSchema.safeParse({ ...oidc, issuer: null }).success).toBe(false);
    expect(providerSchema.safeParse({ ...oidc, clientId: null }).success).toBe(false);
    expect(
      providerSchema.safeParse({ ...oidc, type: "google", issuer: null, clientId: null }).success,
    ).toBe(false);
    expect(
      providerSchema.safeParse({ ...oidc, type: "credentials", issuer: null, clientId: null })
        .success,
    ).toBe(true);
  });

  it("trims and bounds the issuer", () => {
    expect(providerSchema.parse({ ...oidc, issuer: "  https://idp.example.com  " }).issuer).toBe(
      "https://idp.example.com",
    );
    const long = `https://idp.example.com/${"a".repeat(200)}`;
    expect(providerSchema.safeParse({ ...oidc, issuer: long }).success).toBe(false);
  });

  it("only accepts a lowercase slug key that isn't reserved, and a non-blank name", () => {
    for (const k of ["", "Bad Key", "-x", "a/b", "credential", "x".repeat(65)]) {
      expect(providerSchema.safeParse({ ...oidc, key: k }).success, k).toBe(false);
    }
    expect(providerSchema.safeParse({ ...oidc, key: "google" }).success).toBe(false);
    expect(
      providerSchema.safeParse({ ...oidc, key: "google", type: "google", issuer: null }).success,
    ).toBe(true);
    expect(providerSchema.safeParse({ ...oidc, displayName: "   " }).success).toBe(false);
  });
});

describe("auth provider create / update (#163)", () => {
  it("creates a provider and refuses to overwrite it through create", async () => {
    const row = await createAuthProvider(oidc, actor);
    expect(row.clientSecretEnc).toBeTruthy();
    expect(row.config).toEqual({ tokenUrl: "https://idp.example.com/token" });
    expect(
      await db.auditLog.findFirst({
        where: { action: "settings.auth_provider.create", entityId: row.id },
      }),
    ).not.toBeNull();

    expect(await codeOf(createAuthProvider({ ...oidc, displayName: "Hijack" }, actor))).toBe(
      "KEY_EXISTS",
    );
    expect((await db.authProvider.findUnique({ where: { key } }))?.displayName).toBe("Test IdP");
  });

  it("requires a client secret on create", async () => {
    expect(
      await codeOf(
        createAuthProvider({ ...oidc, key: `${key}-nosecret`, clientSecret: null }, actor),
      ),
    ).toBe("SECRET_REQUIRED");
  });

  it("updates in place, keeps the stored secret when left blank and clears dropped options", async () => {
    const before = await db.authProvider.findUniqueOrThrow({ where: { key } });
    const row = await updateAuthProvider(
      { ...oidc, displayName: "Renamed", clientSecret: null, tokenUrl: null },
      actor,
    );
    expect(row.id).toBe(before.id);
    expect(row.displayName).toBe("Renamed");
    expect(row.clientSecretEnc).toBe(before.clientSecretEnc);
    expect(row.config).toBeNull();
  });

  it("refuses to change a provider's type", async () => {
    expect(
      await codeOf(updateAuthProvider({ ...oidc, type: "credentials", issuer: null }, actor)),
    ).toBe("TYPE_LOCKED");
    expect((await db.authProvider.findUnique({ where: { key } }))?.type).toBe("oidc");
  });

  it("refuses to update a provider that doesn't exist", async () => {
    expect(await codeOf(updateAuthProvider({ ...oidc, key: `${key}-missing` }, actor))).toBe(
      "NOT_FOUND",
    );
  });

  it("allows a single Google provider", async () => {
    const google: ProviderInput = {
      key: googleKeys[0],
      type: "google",
      displayName: "Google",
      enabled: false,
      clientId: "g",
      clientSecret: "s",
    };
    await createAuthProvider(google, actor);
    expect(await codeOf(createAuthProvider({ ...google, key: googleKeys[1] }, actor))).toBe(
      "GOOGLE_EXISTS",
    );
    await deleteAuthProvider(googleKeys[0], actor);
  });
});

describe("auth provider delete (#163, option B)", () => {
  it("refuses when a linked user would have no other way to sign in", async () => {
    await createAuthProvider({ ...oidc, key: keys.lock }, actor);
    await link(users.oidcOnly, keys.lock);
    await link(users.password, keys.lock);

    expect(await authProviderImpact({ id: "x", type: "oidc", key: keys.lock })).toEqual({
      linkedAccounts: 2,
      lockedOut: 1,
    });
    expect(await errorOf(deleteAuthProvider(keys.lock, actor))).toEqual({
      code: "LOCKOUT",
      count: 1,
    });
    expect(await db.authProvider.findUnique({ where: { key: keys.lock } })).not.toBeNull();
    expect(await db.authAccount.count({ where: { providerId: keys.lock } })).toBe(2);
  });

  it("deletes when the linked user still has a password, removing only their link to it", async () => {
    await createAuthProvider({ ...oidc, key: keys.pw }, actor);
    await link(users.password, keys.pw);

    await deleteAuthProvider(keys.pw, actor);
    expect(await db.authProvider.findUnique({ where: { key: keys.pw } })).toBeNull();
    expect(await db.authAccount.count({ where: { providerId: keys.pw } })).toBe(0);
    expect(
      await db.authAccount.count({ where: { userId: users.password, providerId: "credential" } }),
    ).toBe(1);
    expect(
      await db.auditLog.findFirst({
        where: { action: "settings.auth_provider.delete", userId: actor.id },
      }),
    ).not.toBeNull();
    expect(await codeOf(deleteAuthProvider(keys.pw, actor))).toBe("NOT_FOUND");
  });

  it("deletes when the linked user has a passkey", async () => {
    await createAuthProvider({ ...oidc, key: keys.pk }, actor);
    await link(users.passkey, keys.pk);

    await deleteAuthProvider(keys.pk, actor);
    expect(await db.authProvider.findUnique({ where: { key: keys.pk } })).toBeNull();
    expect(await db.authAccount.count({ where: { providerId: keys.pk } })).toBe(0);
  });
});

describe("authProviderImpact queries (#163)", () => {
  const impactOf = async (k: string) =>
    authProviderImpact(await db.authProvider.findUniqueOrThrow({ where: { key: k } }));

  it("counts Google sign-ins under Better Auth's fixed google providerId", async () => {
    await createAuthProvider(
      {
        key: keys.google,
        type: "google",
        displayName: "Google",
        enabled: true,
        clientId: "g",
        clientSecret: "s",
      },
      actor,
    );
    await link(users.google, "google");
    const impact = await impactOf(keys.google);
    expect(impact.linkedAccounts).toBeGreaterThanOrEqual(1);
    expect(impact.lockedOut).toBeGreaterThanOrEqual(1);
    expect(await codeOf(deleteAuthProvider(keys.google, actor))).toBe("LOCKOUT");
    await db.authAccount.deleteMany({ where: { userId: users.google } });
    await db.authProvider.delete({ where: { key: keys.google } });
  });

  it("keeps a user saved by another enabled provider, until that provider is disabled", async () => {
    await createAuthProvider({ ...oidc, key: keys.main }, actor);
    await createAuthProvider({ ...oidc, key: keys.other }, actor);
    await link(users.twoIdps, keys.main);
    await link(users.twoIdps, keys.other);
    expect(await impactOf(keys.main)).toEqual({ linkedAccounts: 1, lockedOut: 0 });

    await updateAuthProvider(
      { ...oidc, key: keys.other, enabled: false, clientSecret: null },
      actor,
    );
    expect(await impactOf(keys.main)).toEqual({ linkedAccounts: 1, lockedOut: 1 });
    expect(await errorOf(deleteAuthProvider(keys.main, actor))).toEqual({
      code: "LOCKOUT",
      count: 1,
    });
  });

  it("ignores a password while credentials login is disabled", async () => {
    await createAuthProvider({ ...oidc, key: keys.off }, actor);
    await link(users.passwordOnly, keys.off);
    const prior = await db.appSetting.findUnique({ where: { key: "credentials_enabled" } });
    try {
      await appSettings.set("credentials_enabled", false, actor.id);
      expect(await impactOf(keys.off)).toEqual({ linkedAccounts: 1, lockedOut: 1 });
      await appSettings.set("credentials_enabled", true, actor.id);
      expect(await impactOf(keys.off)).toEqual({ linkedAccounts: 1, lockedOut: 0 });
    } finally {
      await appSettings.set("credentials_enabled", prior?.value ?? true, actor.id);
      if (!prior) await db.appSetting.delete({ where: { key: "credentials_enabled" } });
    }
  });
});
