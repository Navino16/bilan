import { describe, it, expect } from "vitest";
import { createTranslator } from "next-intl";
import fr from "../../../messages/fr.json";
import en from "../../../messages/en.json";

describe("suggestion day gap wording", () => {
  it.each([
    ["fr", fr, ["le même jour", "à 1 jour d’écart", "à 3 jours d’écart"]],
    ["en", en, ["same day", "1 day apart", "3 days apart"]],
  ] as const)("%s", (locale, messages, expected) => {
    const t = createTranslator({ locale, messages, namespace: "transactions.suggestions" });
    expect([0, 1, 3].map((days) => t("pairWithin", { days }))).toEqual(expected);
  });
});
