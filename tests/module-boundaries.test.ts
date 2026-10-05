// The module-boundary lint (ENG-06): it used to restrict "@/modules/*" aliases only, so a relative
// import ("../work/policy") walked past it. These cases run the real configuration on made-up files.
import { join } from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const eslint = new ESLint({ cwd: root, overrideConfigFile: join(root, "eslint.config.mjs") });

async function boundaryErrors(file: string, source: string): Promise<string[]> {
  const [result] = await eslint.lintText(source, { filePath: join(root, file) });
  return result.messages.filter((message) => message.ruleId === "suzu/module-boundaries").map((message) => message.message);
}

describe("module boundaries", () => {
  it("refuses another module's internals, relative or aliased", async () => {
    expect(await boundaryErrors("src/modules/projects/x.ts", `import { canViewProject } from "../work/policy";\nexport const a = canViewProject;\n`)).toHaveLength(1);
    expect(await boundaryErrors("src/modules/projects/ui/x.tsx", `import { CHANNELS } from "../../work/enums";\nexport const a = CHANNELS;\n`)).toHaveLength(1);
    expect(await boundaryErrors("src/modules/crm/x.ts", `import { canViewProject } from "@/modules/work/policy";\nexport const a = canViewProject;\n`)).toHaveLength(1);
    expect(await boundaryErrors("src/modules/crm/x.ts", `export { canViewProject } from "../work/policy";\n`)).toHaveLength(1);
    expect(await boundaryErrors("src/modules/crm/x.ts", `export const load = () => import("../work/tasks");\n`)).toHaveLength(1);
  });

  it("lets a module through the other's two doors, and the platform kernel everywhere", async () => {
    expect(await boundaryErrors("src/modules/projects/x.ts", `import { canViewProject } from "../work/service";\nexport const a = canViewProject;\n`)).toEqual([]);
    expect(await boundaryErrors("src/modules/projects/ui/x.tsx", `import { CHANNELS } from "../../work/client";\nexport const a = CHANNELS;\n`)).toEqual([]);
    expect(await boundaryErrors("src/modules/projects/x.ts", `import { can } from "../platform/rbac/policy";\nexport const a = can;\n`)).toEqual([]);
    expect(await boundaryErrors("src/modules/projects/ui/x.tsx", `import { tasks } from "../engine/x";\nexport const a = tasks;\n`)).toEqual([]);
  });

  it("allows a schema to name another schema, and a test its fixtures", async () => {
    expect(await boundaryErrors("src/modules/crm/schema.ts", `import { workProject } from "../work/schema";\nexport const a = workProject;\n`)).toEqual([]);
    expect(await boundaryErrors("src/modules/crm/delivery.ts", `import { workProject } from "../work/schema";\nexport const a = workProject;\n`)).toHaveLength(1);
    expect(await boundaryErrors("src/modules/crm/crm.test.ts", `import { createTeam } from "../work/teams";\nexport const a = createTeam;\n`)).toEqual([]);
  });

  it("keeps shared code off the feature modules, and a module's own files relative", async () => {
    expect(await boundaryErrors("src/modules/platform/approvals/x.ts", `import { x } from "../../leave/service";\nexport const a = x;\n`)).toHaveLength(1);
    expect(await boundaryErrors("src/lib/x.ts", `import { x } from "../modules/work/service";\nexport const a = x;\n`)).toHaveLength(1);
    expect(await boundaryErrors("src/modules/work/x.ts", `import { x } from "@/modules/work/tasks";\nexport const a = x;\n`)).toHaveLength(1);
  });
});
