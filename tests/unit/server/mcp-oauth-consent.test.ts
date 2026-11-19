import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeSignature } from "better-auth/crypto";

const findUnique = vi.hoisted(() => vi.fn());
vi.mock("@/server/db", () => ({ db: { oauthClient: { findUnique } } }));

import {
  accessChoices,
  consentScope,
  parseConsentRequest,
  type ConsentRequest,
} from "@/server/mcp/oauth-consent";

const secret = process.env.AUTH_SECRET!;
type Requested = ConsentRequest["requested"];

const both: Requested = { read: true, write: true, offline: true };
const writeOnly: Requested = { read: false, write: true, offline: true };
const readOnly: Requested = { read: true, write: false, offline: false };
const neither: Requested = { read: false, write: false, offline: true };

// Mirrors the plugin's signParams: sorted params, every name listed in ba_param, then sig.
async function signed(overrides: Record<string, string> = {}): Promise<URLSearchParams> {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: "client-1",
    redirect_uri: "http://127.0.0.1:43123/callback",
    scope: "bilan:read bilan:write offline_access",
    state: "st4te",
    code_challenge: "challenge",
    code_challenge_method: "S256",
    exp: String(Math.floor(Date.now() / 1000) + 600),
    ba_iat: String(Date.now()),
    ...overrides,
  });
  for (const name of [...new Set([...params.keys(), "ba_param"])].sort()) {
    params.append("ba_param", name);
  }
  const canonical = new URLSearchParams(
    [...params.entries()].sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : 1)),
  );
  params.set("sig", await makeSignature(canonical.toString(), secret));
  return params;
}

beforeEach(() => {
  findUnique.mockReset();
  findUnique.mockResolvedValue({
    name: "Claude",
    redirectUris: JSON.stringify(["http://127.0.0.1:43123/callback"]),
    disabled: false,
  });
});

describe("accessChoices", () => {
  it.each([
    [both, ["write", "read"]],
    [writeOnly, ["write"]],
    [readOnly, ["read"]],
    [neither, []],
  ])("%o → %o", (requested, choices) => {
    expect(accessChoices(requested)).toEqual(choices);
  });
});

describe("consentScope", () => {
  it("grants the requested subset for each access", () => {
    expect(consentScope(both, "write")).toBe("bilan:read bilan:write offline_access");
    expect(consentScope(both, "read")).toBe("bilan:read offline_access");
    expect(consentScope(writeOnly, "write")).toBe("bilan:write offline_access");
    expect(consentScope(readOnly, "read")).toBe("bilan:read");
  });

  it("refuses an access the client didn't request", () => {
    expect(consentScope({ read: false, write: true, offline: true }, "read")).toBeNull();
    expect(consentScope(readOnly, "write")).toBeNull();
    expect(consentScope(neither, "read")).toBeNull();
    expect(consentScope(neither, "write")).toBeNull();
  });
});

describe("parseConsentRequest", () => {
  it("reads a valid signed query", async () => {
    const params = await signed();
    expect(await parseConsentRequest(params)).toEqual({
      ok: true,
      request: {
        oauthQuery: params.toString(),
        clientId: "client-1",
        clientName: "Claude",
        redirectHost: "127.0.0.1:43123",
        requested: both,
      },
    });
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { clientId: "client-1" } }),
    );
  });

  it("accepts the parameters in any order", async () => {
    const params = await signed({ scope: "bilan:read" });
    const reversed = new URLSearchParams([...params.entries()].reverse());
    const res = await parseConsentRequest(reversed);
    expect(res).toMatchObject({ ok: true, request: { requested: readOnly } });
  });

  it("truncates a long client name to 80 characters", async () => {
    findUnique.mockResolvedValue({
      name: "C".repeat(200),
      redirectUris: JSON.stringify(["http://127.0.0.1:43123/callback"]),
      disabled: false,
    });
    const res = await parseConsentRequest(await signed());
    expect(res.ok && res.request.clientName).toBe("C".repeat(80));
  });

  it("refuses a changed parameter", async () => {
    const params = await signed();
    params.set("scope", "bilan:write");
    expect(await parseConsentRequest(params)).toEqual({ ok: false, error: "INVALID" });
  });

  it("refuses a missing signature", async () => {
    const params = await signed();
    params.delete("sig");
    expect(await parseConsentRequest(params)).toEqual({ ok: false, error: "INVALID" });
  });

  it("tells an expired request from a forged one", async () => {
    const past = String(Math.floor(Date.now() / 1000) - 1);
    expect(await parseConsentRequest(await signed({ exp: past }))).toEqual({
      ok: false,
      error: "EXPIRED",
    });
    const forged = await signed({ exp: past });
    forged.set("state", "other");
    expect(await parseConsentRequest(forged)).toEqual({ ok: false, error: "INVALID" });
  });

  it("refuses an unknown or disabled client", async () => {
    findUnique.mockResolvedValue(null);
    expect(await parseConsentRequest(await signed())).toEqual({
      ok: false,
      error: "UNKNOWN_CLIENT",
    });
    findUnique.mockResolvedValue({ name: "x", redirectUris: "[]", disabled: true });
    expect(await parseConsentRequest(await signed())).toEqual({
      ok: false,
      error: "UNKNOWN_CLIENT",
    });
  });
});
