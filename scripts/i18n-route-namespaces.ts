// Which message namespaces each part of the app hands to the browser (PERF-01).
//
// `NextIntlClientProvider` serialises its messages into every page, and the catalogue is most of a
// megabyte. The browser only needs the words its client components look up, so the app's shell
// (the root layout, `(app)/layout.tsx` and the files beside it) gets its own few namespaces and each
// top-level section under `(app)/` (work, payroll, people, …) adds its own in its `layout.tsx`
// (`src/i18n/segment-messages.tsx`). Server components are not affected: they read the whole
// catalogue on the server.
//
// The table is worked out here, from the code, and written to `src/i18n/route-namespaces.generated.ts`;
// `tests/i18n-route-namespaces.test.ts` fails when it is out of date. Run: pnpm i18n:routes
// (`pnpm i18n:routes --why work.palette` says which file brings a namespace in).
//
// How: from every file of a section, follow the imports (`@/…`, relative, and `import("…")`, which
// is how `next/dynamic` loads). A file is client code when it says "use client" or a client file
// imports it ("use server" files are action references, never client code). A client component
// reaches messages only through `useTranslations(namespace)`, so the namespaces are what client
// code binds a translator to:
//   · the literal it is called with — `useTranslations("work.palette")` sends `work.palette`;
//   · a constant of the same file — `useTranslations(ERRORS)`;
//   · a prop called `…namespace` — `useTranslations(namespace)` — whose value is the literal
//     written where the prop is given, in a client file or a server page alike
//     (`<FormError namespace="kb.errors">`, `errorNamespace="payroll.errors"`).
// Anything else (no namespace, a computed one) cannot be read off the code and is reported as
// unresolved; the test refuses it, so a new pattern is a decision made here and never a word
// missing on a screen.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript";

const ROOT = resolve(import.meta.dirname, "..");
const APP = join(ROOT, "src", "app", "(app)");
export const GENERATED_PATH = join(ROOT, "src", "i18n", "route-namespaces.generated.ts");

type Catalogue = Record<string, unknown>;

const EXTENSIONS = [".tsx", ".ts", ".mts", ".js", ".mjs"];

function resolveImport(from: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = join(ROOT, "src", specifier.slice(2));
  else if (specifier.startsWith("./") || specifier.startsWith("../")) base = resolve(dirname(from), specifier);
  else return null;
  if (EXTENSIONS.some((extension) => base.endsWith(extension)) && existsSync(base)) return base;
  for (const extension of EXTENSIONS) if (existsSync(base + extension)) return base + extension;
  for (const extension of EXTENSIONS) if (existsSync(join(base, `index${extension}`))) return join(base, `index${extension}`);
  return null;
}

/** What one file says: its directive, what it imports and the namespaces it names. */
type Parsed = {
  directive: "client" | "server" | null;
  imports: string[];
  /** What a `useTranslations` here is bound to. */
  bound: string[];
  /** Literals given to something called a namespace (a prop, a property, a variable). */
  named: { text: string; jsx: boolean }[];
  /** Translators bound to something this file does not spell out. */
  unresolved: string[];
};
const parsedCache = new Map<string, Parsed>();

const NAMESPACE_NAME = /namespace$|^ns$/i;

/** The string a node is when it is a literal, or null. A template names a prefix up to the last dot before its first `${…}`. */
function literalText(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return node.head.text.slice(0, node.head.text.lastIndexOf(".") + 1) || null;
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return literalText(node.expression);
  return null;
}

function parse(file: string): Parsed {
  const hit = parsedCache.get(file);
  if (hit) return hit;
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  let directive: Parsed["directive"] = null;
  for (const statement of source.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) break;
    if (statement.expression.text === "use client") directive = "client";
    if (statement.expression.text === "use server") directive = "server";
  }
  const parsed: Parsed = { directive, imports: [], bound: [], named: [], unresolved: [] };
  const constants = new Map<string, string>();
  const translatorArgs: ts.Expression[] = [];
  const where = (node: ts.Node) => `${relative(ROOT, file)}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;

  const visit = (node: ts.Node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      // A type-only import brings no code to the browser.
      const typeOnly = ts.isImportDeclaration(node) ? node.importClause?.isTypeOnly : node.isTypeOnly;
      if (!typeOnly) parsed.imports.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) {
      parsed.imports.push(node.arguments[0].text);
    } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "useTranslations") {
      if (node.arguments[0]) translatorArgs.push(node.arguments[0]);
      else parsed.unresolved.push(`${where(node)} useTranslations() with no namespace`);
    } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const text = literalText(node.initializer);
      if (text !== null) constants.set(node.name.text, text);
      if (text !== null && NAMESPACE_NAME.test(node.name.text)) parsed.named.push({ text, jsx: false });
    } else if (ts.isJsxAttribute(node) && NAMESPACE_NAME.test(node.name.getText()) && node.initializer) {
      const value = ts.isJsxExpression(node.initializer) ? node.initializer.expression : node.initializer;
      const text = value ? literalText(value) : null;
      if (text !== null) parsed.named.push({ text, jsx: true });
    } else if ((ts.isPropertyAssignment(node) || ts.isParameter(node) || ts.isBindingElement(node)) && NAMESPACE_NAME.test(node.name.getText()) && node.initializer) {
      const text = literalText(node.initializer);
      if (text !== null) parsed.named.push({ text, jsx: false });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  for (const argument of translatorArgs) {
    const branches = ts.isConditionalExpression(argument) ? [argument.whenTrue, argument.whenFalse] : [argument];
    for (const branch of branches) {
      const text = literalText(branch) ?? (ts.isIdentifier(branch) ? (constants.get(branch.text) ?? null) : null);
      if (text !== null) parsed.bound.push(text);
      // A prop called a namespace is answered where the prop is given (`named`, above).
      else if (!(ts.isIdentifier(branch) && NAMESPACE_NAME.test(branch.text))) parsed.unresolved.push(`${where(branch)} useTranslations(${branch.getText()})`);
    }
  }
  parsedCache.set(file, parsed);
  return parsed;
}

/** The deepest namespace of the catalogue a literal names (`work.palette.` → `work.palette`), or null. */
function namespaceOf(literal: string, catalogue: Catalogue): string | null {
  if (!/^[A-Za-z][\w-]*(\.[\w-]*)*$/.test(literal)) return null;
  const found: string[] = [];
  let node: unknown = catalogue;
  for (const segment of literal.split(".").filter(Boolean)) {
    if (!node || typeof node !== "object" || !(segment in (node as Catalogue))) break;
    node = (node as Catalogue)[segment];
    found.push(segment);
  }
  return found.length ? found.join(".") : null;
}

type Why = (namespace: string, file: string, literal: string) => void;

/** The namespaces client code reachable from `entries` binds a translator to; what cannot be read goes to `unresolved`. */
function namespacesFrom(entries: readonly string[], catalogue: Catalogue, unresolved: Set<string>, why?: Why): Set<string> {
  const found = new Set<string>();
  const seen = new Set<string>();
  const add = (literal: string, file: string) => {
    const namespace = namespaceOf(literal, catalogue);
    if (!namespace) return;
    found.add(namespace);
    why?.(namespace, file, literal);
  };
  const stack = entries.map((file) => ({ file, client: false }));
  while (stack.length) {
    const { file, client: inherited } = stack.pop()!;
    const parsed = parse(file);
    const client = parsed.directive === "server" ? false : inherited || parsed.directive === "client";
    const key = `${client ? "c" : "s"}:${file}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (client) {
      for (const literal of parsed.bound) add(literal, file);
      for (const problem of parsed.unresolved) unresolved.add(problem);
    }
    // A server page hands a client component its namespace as a prop.
    for (const { text, jsx } of parsed.named) if (client || jsx) add(text, file);
    for (const specifier of parsed.imports) {
      const target = resolveImport(file, specifier);
      if (target) stack.push({ file: target, client });
    }
  }
  return found;
}

/** Drops a namespace another one in the set already contains (`work` covers `work.palette`). */
function minimal(namespaces: Iterable<string>): string[] {
  const all = [...new Set(namespaces)].sort();
  return all.filter((namespace) => !all.some((other) => other !== namespace && namespace.startsWith(`${other}.`)));
}

function filesUnder(directory: string): string[] {
  return readdirSync(directory)
    .sort()
    .flatMap((name) => {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) return filesUnder(path);
      return /\.(tsx?|mts)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
    });
}

/** The top-level sections of the signed-in app: each directory under `(app)/`. */
export function appSegments(): string[] {
  return readdirSync(APP)
    .filter((name) => statSync(join(APP, name)).isDirectory())
    .sort();
}

export type RouteNamespaces = { shell: string[]; segments: Record<string, string[]>; unresolved: string[] };

/** `why` hears every literal that brought a namespace in, and from which file. */
export function computeRouteNamespaces(why?: (where: string, namespace: string, file: string, literal: string) => void): RouteNamespaces {
  parsedCache.clear();
  const catalogue = JSON.parse(readFileSync(join(ROOT, "messages", "vi.json"), "utf8")) as Catalogue;
  const unresolved = new Set<string>();
  const shellEntries = [join(ROOT, "src", "app", "layout.tsx"), ...readdirSync(APP).sort().map((name) => join(APP, name)).filter((path) => statSync(path).isFile() && /\.tsx?$/.test(path))];
  const shell = minimal(namespacesFrom(shellEntries, catalogue, unresolved, why && ((...args) => why("shell", ...args))));
  const covered = (namespace: string) => shell.some((held) => namespace === held || namespace.startsWith(`${held}.`));
  const segments: Record<string, string[]> = {};
  for (const segment of appSegments()) {
    // What the shell already carries is not sent twice.
    segments[segment] = minimal(namespacesFrom(filesUnder(join(APP, segment)), catalogue, unresolved, why && ((...args) => why(segment, ...args)))).filter((namespace) => !covered(namespace));
  }
  return { shell, segments, unresolved: [...unresolved].sort() };
}

export function renderGenerated({ shell, segments }: RouteNamespaces): string {
  const list = (items: readonly string[]) => `[${items.map((item) => JSON.stringify(item)).join(", ")}]`;
  return [
    "// Generated by `pnpm i18n:routes` (scripts/i18n-route-namespaces.ts) — do not edit by hand.",
    "// The message namespaces the browser is handed: the app's shell, and what each section adds.",
    "",
    `export const SHELL_NAMESPACES: readonly string[] = ${list(shell)};`,
    "",
    "export const SEGMENT_NAMESPACES = {",
    ...Object.entries(segments).map(([segment, namespaces]) => `  ${/^[a-z]\w*$/i.test(segment) ? segment : JSON.stringify(segment)}: ${list(namespaces)},`),
    "} as const satisfies Record<string, readonly string[]>;",
    "",
    "export type AppSegment = keyof typeof SEGMENT_NAMESPACES;",
    "",
  ].join("\n");
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const asked = process.argv.indexOf("--why");
  if (asked > 0) {
    const namespace = process.argv[asked + 1];
    computeRouteNamespaces((where, found, file, literal) => {
      if (found === namespace || found.startsWith(`${namespace}.`) || namespace.startsWith(`${found}.`)) console.log(`${where}: ${relative(ROOT, file)} "${literal}"`);
    });
    process.exit(0);
  }
  const computed = computeRouteNamespaces();
  if (computed.unresolved.length) {
    console.error(`Translators whose namespace cannot be read off the code:\n  ${computed.unresolved.join("\n  ")}`);
    process.exit(1);
  }
  writeFileSync(GENERATED_PATH, renderGenerated(computed));
  console.log(`Wrote ${relative(ROOT, GENERATED_PATH)}`);
}
