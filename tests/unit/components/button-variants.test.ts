import { describe, it, expect } from "vitest";
import { buttonVariants } from "@/components/ui/button";

const classes = (...args: Parameters<typeof buttonVariants>) => buttonVariants(...args).split(" ");

describe("buttonVariants", () => {
  it("gives an outline link its border colour over the transparent base", () => {
    const outline = classes({ variant: "outline", size: "sm" });
    expect(outline).toContain("border-border");
    expect(outline).not.toContain("border-transparent");
  });

  it("keeps the transparent border on the other variants", () => {
    expect(classes()).toContain("border-transparent");
    expect(classes({ variant: "ghost" })).toContain("border-transparent");
  });

  it("separates every base class (no glued utilities)", () => {
    const base = classes();
    expect(base).toContain("aria-disabled:active:translate-y-0");
    expect(base).toContain("aria-invalid:border-destructive");
    expect(base.filter((c) => /[a-z0-9]aria-/.test(c))).toEqual([]);
  });

  it("lets a caller class win over the variant", () => {
    expect(classes({ variant: "outline", className: "border-destructive" })).not.toContain(
      "border-border",
    );
  });
});
