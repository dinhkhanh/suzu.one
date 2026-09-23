import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

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
  ]),
  // Configuration is read and validated in one place (CLAUDE.md). instrumentation.ts and the
  // error reporters are the exception: error reporting must work even when the configuration is what is broken.
  {
    files: ["src/**"],
    ignores: ["src/lib/env.ts", "src/instrumentation.ts", "src/lib/observability/report.ts", "src/lib/observability/browser.ts", "src/**/*.test.ts"],
    rules: {
      "no-restricted-syntax": ["error", { selector: "MemberExpression[object.name='process'][property.name='env']", message: "Read configuration through env() from @/lib/env." }],
    },
  },
  // Module boundaries (development plan §2.1). `platform` is the shared kernel; every other module
  // is reached only through its `service.ts`. Inside a module, use relative imports.
  {
    files: ["src/modules/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@/app/**", "**/app/(app)/**"], message: "Modules must not depend on routes." },
            {
              group: ["@/modules/*/**", "!@/modules/platform/**", "!@/modules/*/service"],
              message: "Import another module only through its service.ts.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/modules/platform/**", "src/lib/**", "src/components/**"],
    ignores: ["src/lib/db/schema.ts"],
    rules: {
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
]);

export default eslintConfig;
