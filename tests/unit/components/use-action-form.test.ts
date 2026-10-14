import { describe, it, expect } from "vitest";
import { codesShownOnFields, formAlert } from "@/components/forms/use-action-form";

const control = (name: string, type = "text", field?: string) =>
  ({ name, type, dataset: field ? { field } : {} }) as unknown as Element;

describe("codesShownOnFields", () => {
  it("keeps only the codes of fields with a visible control (#227)", () => {
    const form = { elements: [control("confirmEmail"), control("token", "hidden")] };
    expect(
      codesShownOnFields(form, { password: "REQUIRED", confirmEmail: "BAD_CONFIRM", token: "X" }),
    ).toEqual(["BAD_CONFIRM"]);
  });

  it("matches a control answering for another field through data-field", () => {
    const form = { elements: [control("amount", "text", "lines.0.plannedAmount")] };
    expect(codesShownOnFields(form, { "lines.0.plannedAmount": "AMOUNT_INVALID" })).toEqual([
      "AMOUNT_INVALID",
    ]);
  });
});

describe("formAlert", () => {
  it("drops the alert when a rendered field shows the same code", () => {
    expect(formAlert("BAD_PASSWORD", ["BAD_PASSWORD"], true)).toBeNull();
  });

  it("keeps the alert when the field carrying the code isn't rendered", () => {
    expect(formAlert("REQUIRED", [], true)).toBe("REQUIRED");
  });

  it("drops a generic summary only for forms that opt out of it", () => {
    expect(formAlert("INVALID", ["OUT_OF_RANGE"], true)).toBe("INVALID");
    expect(formAlert("INVALID", ["OUT_OF_RANGE"], false)).toBeNull();
    expect(formAlert("FAILED", [], false)).toBe("FAILED");
  });
});
