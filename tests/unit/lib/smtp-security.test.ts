import { describe, it, expect } from "vitest";
import { portAfterSecurityChange, SMTP_DEFAULT_PORTS } from "@/lib/smtp-security";

describe("portAfterSecurityChange (#255)", () => {
  it("maps each mode to its usual port", () => {
    expect(SMTP_DEFAULT_PORTS).toEqual({ STARTTLS: 587, TLS: 465, NONE: 25 });
  });

  it("follows the new mode while the port still holds a mode default", () => {
    expect(portAfterSecurityChange("587", "TLS")).toBe("465");
    expect(portAfterSecurityChange("465", "STARTTLS")).toBe("587");
    expect(portAfterSecurityChange("587", "NONE")).toBe("25");
    expect(portAfterSecurityChange("25", "STARTTLS")).toBe("587");
  });

  it("keeps a custom or empty port", () => {
    expect(portAfterSecurityChange("2525", "TLS")).toBe("2525");
    expect(portAfterSecurityChange("", "TLS")).toBe("");
  });
});
