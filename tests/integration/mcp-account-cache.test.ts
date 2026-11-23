import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// React `cache` only memoizes inside an RSC render; this stand-in memoizes for the whole
// file, so an MCP and a non-MCP call for the same user would share a result if the key
// ignored the MCP context.
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    cache: <A extends unknown[], R>(fn: (...args: A) => R) => {
      const memo = new Map<string, R>();
      return (...args: A): R => {
        const key = JSON.stringify(args);
        if (!memo.has(key)) memo.set(key, fn(...args));
        return memo.get(key)!;
      };
    },
  };
});

import { db } from "@/server/db";
import { visibleAccountIds } from "@/server/services/accounts";
import { getOnboardingState } from "@/server/services/onboarding";
import { runAsMcp } from "@/server/mcp/context";
import {
  cleanupMcpFixture,
  createMcpFixture,
  mcpPrincipal,
  type McpFixture,
} from "./support/mcp-fixtures";

const PREFIX = "mcpcache";
// Household member owning no account: only the WRITE share of `shared-plain` (AI not allowed).
const writerId = `${PREFIX}_writer`;
let f: McpFixture;

beforeAll(async () => {
  f = await createMcpFixture(PREFIX, new Date("2026-06-15T12:00:00.000Z"));
  await db.user.deleteMany({ where: { id: writerId } });
  await db.user.create({ data: { id: writerId, email: `${writerId}@bilan.local`, name: "W" } });
  await db.groupMember.create({ data: { groupId: f.groupId, userId: writerId, role: "MEMBER" } });
});

afterAll(async () => {
  await cleanupMcpFixture(PREFIX);
  await db.user.deleteMany({ where: { id: writerId } });
  await db.$disconnect();
});

describe("visibleAccountRefs memoization", () => {
  it("never hands an MCP call the page's account set, nor the reverse", async () => {
    const asMcp = () => runAsMcp(mcpPrincipal(f.memberId), () => visibleAccountIds(f.memberId));

    expect(await visibleAccountIds(f.memberId)).toHaveLength(3);
    expect(await asMcp()).toHaveLength(2);
    expect(await visibleAccountIds(f.memberId)).toHaveLength(3);
    expect(await asMcp()).toHaveLength(2);
  });
});

describe("getOnboardingState", () => {
  it("ignores a WRITE share without the AI flag in an MCP call, under its own memo key", async () => {
    const asMcp = () => runAsMcp(mcpPrincipal(writerId), () => getOnboardingState(writerId));

    expect((await getOnboardingState(writerId)).addBlocker).toBeNull();
    expect((await asMcp()).addBlocker).toBe("READ_ONLY");
    expect((await getOnboardingState(writerId)).addBlocker).toBeNull();
    expect((await asMcp()).addBlocker).toBe("READ_ONLY");
  });
});
