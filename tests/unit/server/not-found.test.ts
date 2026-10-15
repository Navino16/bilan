import { describe, expect, it } from "vitest";
import { notFoundResponse } from "@/server/http/not-found";
import { pageLocale } from "@/server/http/request-locale";

const h = (init: Record<string, string>) => new Headers(init);

describe("pageLocale", () => {
  it("prefers the path segment, then the cookie, then Accept-Language", () => {
    const all = h({ cookie: "NEXT_LOCALE=fr", "accept-language": "fr" });
    expect(pageLocale("/en/setup", all)).toBe("en");
    expect(
      pageLocale("/setup", h({ cookie: "a=1; NEXT_LOCALE=en", "accept-language": "fr" })),
    ).toBe("en");
    expect(pageLocale("/setup", h({ "accept-language": "de, en;q=0.8" }))).toBe("en");
    expect(pageLocale("/de/setup", h({}))).toBe("fr");
  });
});

describe("notFoundResponse", () => {
  it("serves the 404 in the page's locale", async () => {
    const en = notFoundResponse("/en/setup", h({ "accept-language": "fr" }), "Bilan");
    expect(en.status).toBe(404);
    expect(en.headers.get("content-language")).toBe("en");
    const enBody = await en.text();
    expect(enBody).toContain('<html lang="en">');
    expect(enBody).toContain("This page doesn’t exist or has moved.");
    expect(enBody).toContain('<a href="/en">Back</a>');
    expect(enBody).toContain("<title>Page not found · Bilan</title>");

    const fr = await notFoundResponse("/fr/setup", h({ "accept-language": "en" }), "Bilan").text();
    expect(fr).toContain('<html lang="fr">');
    expect(fr).toContain("Cette page n’existe pas ou a été déplacée.");
    expect(fr).toContain('<a href="/fr">Retour</a>');
  });

  it("names the instance, HTML-escaped (#226)", async () => {
    const body = await notFoundResponse("/fr/setup", h({}), `Tom & "Jerry" <b>`).text();
    expect(body).toContain(
      "<title>Page introuvable · Tom &amp; &quot;Jerry&quot; &lt;b&gt;</title>",
    );
    expect(body).toContain("<h1>Tom &amp; &quot;Jerry&quot; &lt;b&gt;</h1>");
    expect(body).not.toContain("<b>");
  });
});
