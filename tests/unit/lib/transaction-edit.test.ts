import { describe, it, expect } from "vitest";
import { editScope } from "@/lib/transaction-edit";

describe("editScope", () => {
  it("lets a manual row on an open account edit every field", () => {
    expect(editScope({ imported: false, archived: false })).toBe("full");
  });

  it("limits an imported row to its label and note", () => {
    expect(editScope({ imported: true, archived: false })).toBe("text");
  });

  it("limits a row on an archived account to its label and note", () => {
    expect(editScope({ imported: false, archived: true })).toBe("text");
  });
});
