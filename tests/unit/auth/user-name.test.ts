import { describe, it, expect } from "vitest";
import { NAME_MAX } from "@/lib/validation/name";
import { nameOnCreate, nameOnUpdate } from "@/server/auth/user-name";

describe("Better Auth user name hooks", () => {
  it("trims the name on create and falls back to the email when blank", () => {
    expect(nameOnCreate({ name: "  Ann  ", email: "a@b.c" })).toEqual({ name: "Ann" });
    expect(nameOnCreate({ name: "   ", email: "a@b.c" })).toEqual({ name: "a@b.c" });
    expect(nameOnCreate({ email: "a@b.c" })).toEqual({ name: "a@b.c" });
  });

  it("caps both the name and the email fallback at the maximum length", () => {
    const long = `${"a".repeat(NAME_MAX + 20)}@b.c`;
    expect(nameOnCreate({ name: "n".repeat(NAME_MAX + 5), email: "a@b.c" }).name).toHaveLength(
      NAME_MAX,
    );
    expect(nameOnCreate({ name: "", email: long }).name).toHaveLength(NAME_MAX);
  });

  it("trims the name on update, rejects a blank one and ignores updates without a name", () => {
    expect(nameOnUpdate({ name: " Bob " })).toEqual({ name: "Bob" });
    expect(() => nameOnUpdate({ name: "  " })).toThrow();
    expect(nameOnUpdate({})).toBeUndefined();
  });
});
