import { describe, expect, it } from "vitest";
import fr from "../../../messages/fr.json";
import en from "../../../messages/en.json";
import { CLIENT_SCOPES, type ClientScope } from "@/i18n/client-scopes";
import { clientReach, providers, relative } from "./client-graph";

const all = providers();

// Drops the namespaces an ancestor namespace already covers.
function minimal(namespaces: Iterable<string>): string[] {
  const list = [...new Set(namespaces)];
  return list.filter((ns) => !list.some((other) => ns.startsWith(other + "."))).sort();
}

function has(messages: object, namespace: string): boolean {
  let node: unknown = messages;
  for (const key of namespace.split(".")) {
    if (typeof node !== "object" || node === null || !(key in node)) return false;
    node = (node as Record<string, unknown>)[key];
  }
  return typeof node === "object";
}

describe("client message scopes (#303)", () => {
  it("cover every route under [locale], each scope once", () => {
    expect(all.map((p) => p.scope).sort()).toEqual(Object.keys(CLIENT_SCOPES).sort());
  });

  it.each(all.map((p) => [p.scope, p] as const))(
    "%s lists exactly the namespaces its client components use",
    (scope, provider) => {
      const reach = clientReach(provider.entries);
      expect(reach.wholeCatalogue.map(relative)).toEqual([]);
      expect([...CLIENT_SCOPES[scope as ClientScope]].sort()).toEqual(minimal(reach.namespaces));
    },
  );

  it.each(Object.entries(CLIENT_SCOPES))("%s namespaces exist in both catalogues", (_, list) => {
    for (const ns of list) {
      expect(has(fr, ns), `fr ${ns}`).toBe(true);
      expect(has(en, ns), `en ${ns}`).toBe(true);
    }
  });
});

describe("client bundle (#303)", () => {
  it("never reaches zod: schemas stay in lib/schemas, client code imports lib/validation", () => {
    const reach = clientReach(all.flatMap((p) => p.entries));
    expect((reach.packages.get("zod") ?? []).map(relative)).toEqual([]);
  });
});
