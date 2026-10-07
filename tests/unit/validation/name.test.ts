import { describe, it, expect } from "vitest";
import { NAME_MAX, displayName, nameSchema } from "@/lib/validation/name";
import { canRemoveMember } from "@/lib/validation/group";

describe("nameSchema", () => {
  it("trims surrounding spaces", () => {
    expect(nameSchema.parse("  Ada Lovelace ")).toBe("Ada Lovelace");
  });

  it("rejects blank and space-only names", () => {
    for (const v of ["", " ", "   \t  "]) expect(nameSchema.safeParse(v).success, v).toBe(false);
  });

  it("rejects names over the maximum length", () => {
    expect(nameSchema.safeParse("a".repeat(NAME_MAX)).success).toBe(true);
    expect(nameSchema.safeParse("a".repeat(NAME_MAX + 1)).success).toBe(false);
  });
});

describe("displayName", () => {
  it("falls back to the email when the name is null, empty or blank", () => {
    expect(displayName({ name: "Ada", email: "a@b.c" })).toBe("Ada");
    for (const name of [null, "", "   "])
      expect(displayName({ name, email: "a@b.c" })).toBe("a@b.c");
  });
});

describe("canRemoveMember", () => {
  it("lets an owner remove anyone", () => {
    expect(canRemoveMember("OWNER", "OWNER")).toBe(true);
    expect(canRemoveMember("OWNER", "ADMIN")).toBe(true);
    expect(canRemoveMember("OWNER", "MEMBER")).toBe(true);
  });

  it("lets an admin remove members only, never a peer or an owner", () => {
    expect(canRemoveMember("ADMIN", "MEMBER")).toBe(true);
    expect(canRemoveMember("ADMIN", "ADMIN")).toBe(false);
    expect(canRemoveMember("ADMIN", "OWNER")).toBe(false);
  });

  it("never lets a member remove anyone", () => {
    expect(canRemoveMember("MEMBER", "MEMBER")).toBe(false);
  });
});
