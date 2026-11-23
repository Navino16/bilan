import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = path.resolve(__dirname, "../../..");
const SRC = path.join(ROOT, "src");
export const LOCALE_DIR = path.join(SRC, "app", "[locale]");

const ROUTE_FILES = [
  "layout",
  "template",
  "page",
  "default",
  "error",
  "not-found",
  "forbidden",
  "unauthorized",
  "loading",
];
const EXTENSIONS = [".tsx", ".ts", ".js", ".mjs"];

type Module = {
  client: boolean;
  server: boolean;
  namespaces: string[];
  wholeCatalogue: boolean;
  local: string[];
  packages: string[];
};

const modules = new Map<string, Module>();

function resolveLocal(from: string, specifier: string): string | null {
  const base = specifier.startsWith("@/")
    ? path.join(SRC, specifier.slice(2))
    : path.resolve(path.dirname(from), specifier);
  for (const candidate of [
    base,
    ...EXTENSIONS.map((e) => base + e),
    ...EXTENSIONS.map((e) => path.join(base, "index" + e)),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

// Imports that survive compilation: `import type` and all-`type` specifier lists are elided.
function runtimeSpecifiers(file: string, source: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false);
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const typeOnly =
        clause?.phaseModifier === ts.SyntaxKind.TypeKeyword ||
        (clause &&
          !clause.name &&
          clause.namedBindings &&
          ts.isNamedImports(clause.namedBindings) &&
          clause.namedBindings.elements.length > 0 &&
          clause.namedBindings.elements.every((e) => e.isTypeOnly));
      if (!typeOnly) out.push(node.moduleSpecifier.text);
    } else if (
      ts.isExportDeclaration(node) &&
      !node.isTypeOnly &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      out.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      out.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

function load(file: string): Module {
  const cached = modules.get(file);
  if (cached) return cached;
  const source = readFileSync(file, "utf8");
  const local: string[] = [];
  const packages: string[] = [];
  for (const specifier of runtimeSpecifiers(file, source)) {
    if (specifier.startsWith(".") || specifier.startsWith("@/")) {
      const resolved = resolveLocal(file, specifier);
      if (resolved && !resolved.endsWith(".json")) local.push(resolved);
    } else {
      packages.push(specifier);
    }
  }
  const mod: Module = {
    client: /^\s*["']use client["']/m.test(source),
    server: /^\s*["']use server["']/m.test(source),
    namespaces: [...source.matchAll(/useTranslations\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]),
    wholeCatalogue: /useTranslations\(\s*\)|useMessages\(/.test(source),
    local,
    packages,
  };
  modules.set(file, mod);
  return mod;
}

export type ClientReach = {
  files: Set<string>;
  namespaces: Set<string>;
  wholeCatalogue: string[];
  packages: Map<string, string[]>;
};

// Modules that ship to the browser from these entries: everything at or below a "use client" file.
export function clientReach(entries: string[]): ClientReach {
  const reach: ClientReach = {
    files: new Set(),
    namespaces: new Set(),
    wholeCatalogue: [],
    packages: new Map(),
  };
  const seen = new Set<string>();
  const stack = entries.map((file) => ({ file, client: false }));
  while (stack.length) {
    const { file, client: parentClient } = stack.pop()!;
    const mod = load(file);
    // A client import of a "use server" module ships only an action reference.
    if (parentClient && mod.server) continue;
    const client = parentClient || mod.client;
    const key = `${client}:${file}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (client) {
      reach.files.add(file);
      mod.namespaces.forEach((ns) => reach.namespaces.add(ns));
      if (mod.wholeCatalogue) reach.wholeCatalogue.push(file);
      for (const pkg of mod.packages) {
        reach.packages.set(pkg, [...(reach.packages.get(pkg) ?? []), file]);
      }
    }
    for (const next of mod.local) stack.push({ file: next, client });
  }
  return reach;
}

export function relative(file: string): string {
  return path.relative(ROOT, file);
}

function routeFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => ROUTE_FILES.some((r) => EXTENSIONS.some((e) => name === r + e)))
    .map((name) => path.join(dir, name));
}

function subdirs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(dir, d.name));
}

function layoutScope(dir: string): string | null {
  const layout = routeFiles(dir).find((f) => path.basename(f).startsWith("layout."));
  if (!layout) return null;
  return (
    readFileSync(layout, "utf8").match(
      /(?:<ClientMessages\s+scope=|messagesLayout\()"([^"]+)"/,
    )?.[1] ?? null
  );
}

export type Provider = { scope: string; dir: string; entries: string[] };

// Each `<ClientMessages scope>` layout covers the route files of its directory and of the
// directories below it, down to the next layout that sets its own scope.
export function providers(dir = LOCALE_DIR, owner?: Provider): Provider[] {
  const scope = layoutScope(dir);
  const found: Provider[] = [];
  let current = owner;
  if (scope) {
    current = { scope, dir, entries: [] };
    found.push(current);
  }
  if (!current) throw new Error(`${relative(dir)} renders outside any <ClientMessages> scope`);
  current.entries.push(...routeFiles(dir));
  for (const sub of subdirs(dir)) found.push(...providers(sub, current));
  return found;
}
