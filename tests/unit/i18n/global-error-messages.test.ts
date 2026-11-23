import { describe, expect, it } from "vitest";
import fr from "../../../messages/fr.json";
import en from "../../../messages/en.json";
import { GLOBAL_ERROR_MESSAGES } from "@/i18n/global-error-messages";

describe("global error messages (#245)", () => {
  it("match errors.serverError in the catalogues", () => {
    expect(GLOBAL_ERROR_MESSAGES).toEqual({
      fr: fr.errors.serverError,
      en: en.errors.serverError,
    });
  });
});
