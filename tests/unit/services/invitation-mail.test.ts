import { describe, expect, it } from "vitest";
import { invitationMail, oneLine } from "@/server/services/mail/invitation";

const input = {
  appName: "Bilan",
  inviter: "Alice",
  group: "Maison",
  acceptUrl: "https://bilan.example/en/groups/join/tok",
  code: "ABC234",
  ttlDays: 7,
};

describe("invitationMail", () => {
  it("names the inviter and the household, with the link, code and expiry per locale", () => {
    const en = invitationMail("en", input);
    expect(en.subject).toBe("Bilan — invitation to join the household “Maison”");
    expect(en.text).toContain("Alice invited you to join the household “Maison” on Bilan.");
    expect(en.text).toContain(`Link: ${input.acceptUrl}`);
    expect(en.text).toContain("Code: ABC234");
    expect(en.text).toContain("expires in 7 days");

    const fr = invitationMail("fr", input);
    expect(fr.subject).toBe("Bilan — invitation à rejoindre le foyer « Maison »");
    expect(fr.text).toContain("Alice vous invite à rejoindre le foyer « Maison » sur Bilan.");
    expect(fr.text).toContain(`Lien : ${input.acceptUrl}`);
    expect(fr.text).toContain("Code : ABC234");
    expect(fr.text).toContain("7 jours");
  });

  it("keeps user-chosen names on one bounded line", () => {
    const mail = invitationMail("en", {
      ...input,
      group: "Maison\r\nBcc: evil@example.com",
      inviter: "x".repeat(300),
    });
    expect(mail.subject).not.toMatch(/[\r\n]/);
    expect(mail.subject).toContain("“Maison Bcc: evil@example.com”");
    expect(mail.text.split("\n")[0]).toMatch(/^x{99}… invited you/);
  });

  it("oneLine strips control characters and collapses whitespace", () => {
    expect(oneLine("  a\tb\u2028c\u0000 d  ")).toBe("a b c d");
    expect(oneLine("abcdef", 4)).toBe("abc…");
    expect(oneLine("abcd", 4)).toBe("abcd");
  });
});
