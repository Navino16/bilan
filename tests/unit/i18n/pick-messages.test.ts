import { describe, expect, it } from "vitest";
import { pickMessages } from "@/i18n/pick-messages";

const messages = {
  shell: { nav: { home: "Home" }, theme: { dark: "Dark" } },
  rules: { transfer: { batch: { title: "Batch" } }, error: { INVALID: "Invalid" } },
  admin: { title: "Admin" },
};

describe("pickMessages", () => {
  it("copies whole namespaces and nested ones, nothing else", () => {
    expect(pickMessages(messages, ["admin", "shell.theme", "rules.transfer.batch"])).toEqual({
      admin: { title: "Admin" },
      shell: { theme: { dark: "Dark" } },
      rules: { transfer: { batch: { title: "Batch" } } },
    });
  });

  it("merges sibling namespaces without touching the catalogue", () => {
    const picked = pickMessages(messages, ["shell.nav", "shell.theme"]);
    expect(picked).toEqual({ shell: messages.shell });
    expect(picked.shell).not.toBe(messages.shell);
  });

  it("returns an empty catalogue for no namespace", () => {
    expect(pickMessages(messages, [])).toEqual({});
  });
});
