import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";
import path from "node:path";

// Module boundaries (development plan §2.1), checked on the resolved path, so a relative import
// ("../work/policy") is held to the same rule as an aliased one ("@/modules/work/policy").
//
// `platform` is the shared kernel: any module may use any of it, and it uses no other module (an
// older module learns of a newer one through a platform registry). Every other module is reached
// through one of two doors: `service.ts` for code on the server, `client.ts` for another module's
// screens (value lists and shared client pieces, nothing that reaches the database). Two
// exceptions: a `schema.ts` may name another module's `schema.ts` (the tables are one database and
// foreign keys are how it says so), and a test may build its fixtures with another module's
// internals — production code may not.
const MODULES_ROOT = path.resolve(import.meta.dirname, "src/modules");
const SRC_ROOT = path.resolve(import.meta.dirname, "src");
const DOORS = new Set(["service", "client"]);

/** "src/modules/work/ui/x.tsx" → { module: "work", rest: ["ui", "x"] }; null outside the modules. */
function placeOf(file) {
  const relative = path.relative(MODULES_ROOT, file);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  const [module, ...rest] = relative.split(path.sep);
  return { module, rest: rest.map((part, index) => (index === rest.length - 1 ? part.replace(/\.(tsx?|mjs|js)$/, "") : part)) };
}

const moduleBoundaries = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      door: "Import another module only through its service.ts (or client.ts from a screen): {{target}}.",
      kernel: "Shared code (the platform kernel, src/lib, src/components) must not depend on a feature module: {{target}}.",
      own: "Inside a module, use relative imports: {{target}}.",
    },
  },
  create(context) {
    const file = context.filename;
    // src/lib and src/components are shared code too: held to the kernel's rule.
    const from = placeOf(file) ?? { module: "platform", rest: [] };
    const fromSchema = from.rest.length === 1 && from.rest[0] === "schema";
    const fromTest = /\.test\.tsx?$/.test(file);
    const check = (node, specifier) => {
      if (typeof specifier !== "string") return;
      let resolved;
      if (specifier.startsWith(".")) resolved = path.resolve(path.dirname(file), specifier);
      else if (specifier.startsWith("@/")) resolved = path.resolve(SRC_ROOT, specifier.slice(2));
      else return;
      const to = placeOf(resolved);
      if (!to || to.module === "platform") return;
      if (to.module === from.module) {
        if (specifier.startsWith("@/") && !(to.rest.length === 1 && DOORS.has(to.rest[0]))) context.report({ node, messageId: "own", data: { target: specifier } });
        return;
      }
      if (from.module === "platform") return context.report({ node, messageId: "kernel", data: { target: specifier } });
      if (to.rest.length === 1 && DOORS.has(to.rest[0])) return;
      if (fromSchema && to.rest.length === 1 && to.rest[0] === "schema") return;
      if (fromTest) return;
      context.report({ node, messageId: "door", data: { target: specifier } });
    };
    return {
      ImportDeclaration: (node) => check(node.source, node.source.value),
      ExportNamedDeclaration: (node) => node.source && check(node.source, node.source.value),
      ExportAllDeclaration: (node) => check(node.source, node.source.value),
      ImportExpression: (node) => node.source.type === "Literal" && check(node.source, node.source.value),
    };
  },
};

const suzuPlugin = { rules: { "module-boundaries": moduleBoundaries } };

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Git worktrees of this same repository (parallel agent sessions); each is linted in its own checkout.
    ".claude/worktrees/**",
    // The face kiosk's WebAssembly runtimes, copied from node_modules on install (scripts/kiosk-assets.mjs).
    "public/kiosk/assets/vendor/**",
  ]),
  // Configuration is read and validated in one place (CLAUDE.md). instrumentation.ts, the Sentry
  // initialisers and the error reporters are the exception: error reporting must work even when the
  // configuration is what is broken.
  {
    files: ["src/**"],
    ignores: ["src/lib/env.ts", "src/instrumentation.ts", "src/instrumentation-client.ts", "src/lib/observability/report.ts", "src/lib/observability/server.ts", "src/**/*.test.ts"],
    rules: {
      "no-restricted-syntax": ["error", { selector: "MemberExpression[object.name='process'][property.name='env']", message: "Read configuration through env() from @/lib/env." }],
    },
  },
  // Module boundaries: see `moduleBoundaries` above. Inside a module, use relative imports.
  {
    files: ["src/modules/**"],
    plugins: { suzu: suzuPlugin },
    rules: {
      "suzu/module-boundaries": "error",
      "no-restricted-imports": ["error", { patterns: [{ group: ["@/app/**", "**/app/(app)/**"], message: "Modules must not depend on routes." }] }],
    },
  },
  {
    files: ["src/modules/platform/**", "src/lib/**", "src/components/**"],
    ignores: ["src/lib/db/schema.ts"],
    plugins: { suzu: suzuPlugin },
    rules: {
      "suzu/module-boundaries": "error",
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@/app/**"], message: "Shared code must not depend on routes." },
            { group: ["@/modules/*/**", "!@/modules/platform/**"], message: "Shared code may depend on the platform modules only." },
          ],
        },
      ],
    },
  },
  // Formatting is Prettier's (.prettierrc.json, `pnpm format`): last, so no rule above argues with it.
  prettier,
]);

export default eslintConfig;
