import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { AUDIT_ENTITIES, AUDIT_FAMILIES, SETTING_LABELS, auditActionMessage } from "@/lib/audit";
import fr from "../../../messages/fr.json";
import en from "../../../messages/en.json";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(e.name) ? [path] : [];
  });
}

function lookup(messages: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => {
    return node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined;
  }, messages);
}

const files = sourceFiles(join(__dirname, "../../../src"));
const sources = files.map((f) => readFileSync(f, "utf8"));

// String values of `action:` in object literals (type members excluded), conditional branches
// included: audit events are built as such objects, before or inside logEvent(...).
function actionLiterals(file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest);
  const found: string[] = [];
  const collect = (e: ts.Expression): void => {
    if (ts.isStringLiteralLike(e)) found.push(e.text);
    else if (ts.isConditionalExpression(e)) [e.whenTrue, e.whenFalse].forEach(collect);
    else if (ts.isParenthesizedExpression(e)) collect(e.expression);
  };
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "action"
    ) {
      collect(node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

const loggedActions = new Set(files.flatMap((f, i) => actionLiterals(f, sources[i])));
const loggedEntities = new Set(
  sources.flatMap((s) => [...s.matchAll(/entity: "([A-Za-z]+)"/g)].map((m) => m[1])),
);

describe("auditActionMessage", () => {
  it("shares one label across app-setting updates", () => {
    expect(auditActionMessage("settings.app_name.update")).toEqual({
      key: "settingUpdated",
      setting: "app_name",
    });
    expect(auditActionMessage("settings.security.admin_2fa_required.update")).toEqual({
      key: "settingUpdated",
      setting: "security.admin_2fa_required",
    });
  });

  it("keeps dedicated labels for SMTP and auth providers", () => {
    expect(auditActionMessage("settings.smtp.update")).toEqual({ key: "settings.smtp.update" });
    expect(auditActionMessage("settings.auth_provider.update")).toEqual({
      key: "settings.auth_provider.update",
    });
  });
});

describe.each([
  ["fr", fr],
  ["en", en],
])("audit labels (%s)", (_locale, messages) => {
  it("label every action code the app logs", () => {
    expect(loggedActions.size).toBeGreaterThan(30);
    expect(loggedActions).toContain("auth.register.success");
    for (const code of loggedActions) {
      expect(code).toMatch(/^[a-z0-9_]+(\.[a-zA-Z0-9_]+)+$/);
      const { key } = auditActionMessage(code);
      expect(typeof lookup(messages, `admin.audit.actions.${key}`), code).toBe("string");
    }
  });

  it("name every app setting the admin UI saves (#226)", () => {
    const actions = readFileSync(
      join(__dirname, "../../../src/server/transport/actions/settings.ts"),
      "utf8",
    );
    const saved = [...actions.matchAll(/case "([a-z0-9_.]+)":/g)].map((m) => m[1]);
    expect(saved).toContain("app_name");
    for (const key of saved) {
      expect(SETTING_LABELS, key).toHaveProperty([key]);
      expect(typeof lookup(messages, `admin.settings.${SETTING_LABELS[key]}`), key).toBe("string");
    }
  });

  it("label every family and every logged entity", () => {
    for (const f of AUDIT_FAMILIES) {
      expect(typeof lookup(messages, `admin.audit.families.${f}`), f).toBe("string");
    }
    for (const e of AUDIT_ENTITIES) {
      expect(typeof lookup(messages, `admin.audit.entities.${e}`), e).toBe("string");
    }
    for (const e of loggedEntities) expect(AUDIT_ENTITIES, e).toContain(e);
  });

  it("offer a family filter for every logged action", () => {
    for (const code of loggedActions) {
      expect(
        AUDIT_FAMILIES.some((f) => code.startsWith(`${f}.`)),
        code,
      ).toBe(true);
    }
  });
});
