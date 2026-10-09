import { describe, it, expect } from "vitest";
import { categoryInputSchema, CATEGORY_NAME_MAX } from "@/lib/validation/category";

describe("categoryInputSchema", () => {
  it("accepts a minimal personal category", () => {
    const r = categoryInputSchema.safeParse({ name: "Courses" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.name).toBe("Courses");
      expect(r.data.groupId).toBeUndefined();
      expect(r.data.parentId).toBeUndefined();
    }
  });

  it("normalizes empty optional strings to undefined", () => {
    const r = categoryInputSchema.parse({
      name: "X",
      groupId: "",
      parentId: "",
      icon: "",
      color: "",
    });
    expect(r.groupId).toBeUndefined();
    expect(r.parentId).toBeUndefined();
    expect(r.icon).toBeUndefined();
    expect(r.color).toBeUndefined();
  });

  it("rejects a blank name and an over-long name", () => {
    expect(categoryInputSchema.safeParse({ name: "" }).success).toBe(false);
    expect(categoryInputSchema.safeParse({ name: "a".repeat(CATEGORY_NAME_MAX + 1) }).success).toBe(
      false,
    );
  });

  it("rejects a malformed color", () => {
    expect(categoryInputSchema.safeParse({ name: "X", color: "red" }).success).toBe(false);
    expect(categoryInputSchema.safeParse({ name: "X", color: "#abcdef" }).success).toBe(true);
  });

  it("accepts a theme palette colour but no other CSS variable", () => {
    const r = categoryInputSchema.safeParse({ name: "X", color: "var(--cat-transport)" });
    expect(r.success && r.data.color).toBe("var(--cat-transport)");
    expect(categoryInputSchema.safeParse({ name: "X", color: "var(--primary)" }).success).toBe(
      false,
    );
  });
});
