import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { getAuth } from "@/server/auth";
import { listPasskeys } from "@/server/services/users/passkeys";

const stamp = Date.now();
const password = "passkeys-strong-password-1";
const owner = { email: `passkeys+${stamp}@bilan.local`, id: "", headers: new Headers() };
const other = { email: `passkeys-other+${stamp}@bilan.local`, id: "", headers: new Headers() };

type PasskeyApi = {
  deletePasskey(input: { body: { id: string }; headers: Headers }): Promise<unknown>;
  updatePasskey(input: { body: { id: string; name: string }; headers: Headers }): Promise<unknown>;
};

// getAuth()'s Handler type is built from the base options, so plugin endpoints are untyped.
async function passkeyApi(): Promise<PasskeyApi> {
  return (await getAuth()).api as unknown as PasskeyApi;
}

async function signIn(email: string): Promise<Headers> {
  const auth = await getAuth();
  const res = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
  if (!res.ok) throw new Error(`sign-in failed: ${res.status}`);
  return new Headers({
    cookie: res.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; "),
  });
}

// WebAuthn registration needs a real authenticator (covered by e2e); rows are inserted directly.
async function createPasskey(
  userId: string,
  data: { name?: string; createdAt?: Date; backedUp?: boolean } = {},
) {
  return db.passkey.create({
    data: {
      id: `pk-${userId}-${Math.random().toString(36).slice(2)}`,
      userId,
      publicKey: "pk",
      credentialID: `cred-${Math.random().toString(36).slice(2)}`,
      deviceType: "singleDevice",
      ...data,
    },
  });
}

beforeAll(async () => {
  const auth = await getAuth();
  for (const u of [owner, other]) {
    const res = await auth.api.signUpEmail({
      body: { email: u.email, password, name: "Passkeys" },
    });
    u.id = res.user.id;
    u.headers = await signIn(u.email);
  }
});

afterAll(async () => {
  await db.auditLog.deleteMany({ where: { userId: { in: [owner.id, other.id] } } });
  await db.user.deleteMany({ where: { id: { in: [owner.id, other.id] } } });
  await db.$disconnect();
});

describe("listPasskeys", () => {
  it("lists only the user's passkeys, newest first, without key material", async () => {
    const old = await createPasskey(owner.id, {
      name: "Old key",
      createdAt: new Date("2026-01-01"),
      backedUp: true,
    });
    const recent = await createPasskey(owner.id, { createdAt: new Date("2026-06-01") });
    await createPasskey(other.id);

    const ids = new Set([old.id, recent.id]);
    const list = (await listPasskeys(owner.id)).filter((pk) => ids.has(pk.id));
    expect(list).toEqual([
      { id: recent.id, name: null, createdAt: recent.createdAt, synced: false },
      { id: old.id, name: "Old key", createdAt: old.createdAt, synced: true },
    ]);
  });
});

describe("deleting a passkey", () => {
  it("deletes the user's passkey and audits it", async () => {
    const api = await passkeyApi();
    const pk = await createPasskey(owner.id, { name: "To delete" });

    await api.deletePasskey({ body: { id: pk.id }, headers: owner.headers });

    expect(await db.passkey.findUnique({ where: { id: pk.id } })).toBeNull();
    const audit = await db.auditLog.findFirst({
      where: { userId: owner.id, action: "auth.passkey.deleted", entityId: pk.id },
    });
    expect(audit).toMatchObject({ entity: "Passkey" });
  });

  it("refuses another user's passkey, without auditing", async () => {
    const api = await passkeyApi();
    const pk = await createPasskey(other.id);

    await expect(
      api.deletePasskey({ body: { id: pk.id }, headers: owner.headers }),
    ).rejects.toThrow();

    expect(await db.passkey.findUnique({ where: { id: pk.id } })).not.toBeNull();
    expect(
      await db.auditLog.count({ where: { action: "auth.passkey.deleted", entityId: pk.id } }),
    ).toBe(0);
  });
});

describe("renaming a passkey", () => {
  it("renames the user's passkey", async () => {
    const api = await passkeyApi();
    const pk = await createPasskey(owner.id, { name: "Before" });

    await api.updatePasskey({ body: { id: pk.id, name: "After" }, headers: owner.headers });

    expect((await db.passkey.findUnique({ where: { id: pk.id } }))?.name).toBe("After");
  });

  it("refuses to rename another user's passkey", async () => {
    const api = await passkeyApi();
    const pk = await createPasskey(other.id, { name: "Theirs" });

    await expect(
      api.updatePasskey({ body: { id: pk.id, name: "Mine" }, headers: owner.headers }),
    ).rejects.toThrow();
    expect((await db.passkey.findUnique({ where: { id: pk.id } }))?.name).toBe("Theirs");
  });
});
