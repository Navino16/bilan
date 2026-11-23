import { describe, expect, it } from "vitest";
import { requestLocale, requestLocaleHint } from "@/server/http/request-locale";
import { negotiateLocale } from "@/lib/locale-negotiation";

const APP = "https://bilan.example";
const h = (init: Record<string, string>) => new Headers(init);

describe("requestLocale", () => {
  it("falls back to the default locale", () => {
    expect(requestLocale(undefined, APP)).toBe("fr");
    expect(requestLocale(h({}), APP)).toBe("fr");
    expect(requestLocale(h({ "accept-language": "de-DE,de;q=0.9" }), APP)).toBe("fr");
  });

  it("prefers the locale of the referring page", () => {
    const headers = h({
      referer: `${APP}/en/register?x=1`,
      cookie: "NEXT_LOCALE=fr",
      "accept-language": "fr-FR",
    });
    expect(requestLocale(headers, APP)).toBe("en");
  });

  it("ignores a referer from another origin or without a locale segment", () => {
    const foreign = h({ referer: "https://evil.example/en/x", "accept-language": "fr" });
    expect(requestLocale(foreign, APP)).toBe("fr");
    const noSegment = h({ referer: `${APP}/`, cookie: "a=1; NEXT_LOCALE=en" });
    expect(requestLocale(noSegment, APP)).toBe("en");
    expect(requestLocale(h({ referer: "not a url", "accept-language": "en" }), APP)).toBe("en");
  });

  it("has no hint when the request carries no locale (#245)", () => {
    expect(requestLocaleHint(undefined, APP)).toBeUndefined();
    expect(requestLocaleHint(h({ "accept-language": "de" }), APP)).toBeUndefined();
    expect(requestLocaleHint(h({ referer: `${APP}/en/login` }), APP)).toBe("en");
  });

  it("negotiates from the cookie, then the browser languages (#245)", () => {
    expect(negotiateLocale("a=1; NEXT_LOCALE=en", "fr-FR")).toBe("en");
    expect(negotiateLocale("NEXT_LOCALE=de", "en-US,en")).toBe("en");
    expect(negotiateLocale("", "de")).toBe("fr");
  });

  it("ranks Accept-Language by quality", () => {
    const ranked = h({ "accept-language": "de;q=0.9, fr;q=0.5, en-GB;q=0.8" });
    expect(requestLocale(ranked, APP)).toBe("en");
    expect(requestLocale(h({ "accept-language": "en;q=0, fr" }), APP)).toBe("fr");
  });
});
