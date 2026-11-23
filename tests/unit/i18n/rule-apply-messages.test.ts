import { describe, it, expect } from "vitest";
import fr from "../../../messages/fr.json";
import en from "../../../messages/en.json";

// The learning dialog creates every rule at priority 100, so the rule that keeps rows often
// wins on the tie-break (longer pattern, newer rule), not on a higher priority (#287).
describe("rule application summary copy", () => {
  it("does not claim the winning rule has a higher priority", () => {
    expect(fr.rules.apply.kept).not.toMatch(/prioritaire/);
    expect(en.rules.apply.kept).not.toMatch(/priority/);
  });
});
