import { describe, it, expect, vi } from "vitest";
import { NAME_MAX } from "@/lib/validation/name";

const createGroup = vi.fn();
vi.mock("@/server/auth/permissions", () => ({
  requireSession: async () => ({ id: "u1", email: "u1@bilan.local" }),
}));
vi.mock("@/server/services/groups", () => ({
  createGroup,
  updateGroup: vi.fn(),
  deleteGroup: vi.fn(),
  changeMemberRole: vi.fn(),
  removeMember: vi.fn(),
  leaveGroup: vi.fn(),
  GroupAccessError: class extends Error {},
}));

const { createGroupAction } = await import("@/server/transport/actions/groups");

function form(values: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

describe("createGroupAction field errors (#165)", () => {
  it("returns per-field codes instead of a bare INVALID and never reaches the service", async () => {
    expect(
      await createGroupAction(null, form({ name: "x".repeat(NAME_MAX + 1), description: "" })),
    ).toEqual({ ok: false, error: "INVALID", fieldErrors: { name: "TOO_LONG" } });
    expect(await createGroupAction(null, form({ name: "  ", description: "" }))).toEqual({
      ok: false,
      error: "INVALID",
      fieldErrors: { name: "REQUIRED" },
    });
    expect(createGroup).not.toHaveBeenCalled();
  });

  it("passes the trimmed input on success", async () => {
    expect(await createGroupAction(null, form({ name: " Home ", description: " d " }))).toEqual({
      ok: true,
    });
    expect(createGroup).toHaveBeenCalledWith({ name: "Home", description: "d" }, "u1");
  });
});
