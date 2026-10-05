// Every request type a module defines in code is registered with the approval engine's
// composition root (`src/app/(app)/approvals/registry.ts`). An unregistered type still files and
// decides — its own page calls its own action — but it is missing from the flow administration, so
// the flow its definition promises is configurable cannot be configured; that is how the salary
// change stayed on the default "owner decides" flow with no way to add a CEO step.
//
// It reads the source, like the server-actions guard: the registry imports every module's server
// actions, which is too much to load in a unit test.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "src");

function everySourceFile(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return everySourceFile(path);
    return /\.ts$/.test(entry) && !entry.endsWith(".test.ts") ? [path] : [];
  });
}

const DEFINED = /^export const (\w+) = defineRequestType\(/gm;

describe("the approval registry", () => {
  const registry = readFileSync(join(ROOT, "app", "(app)", "approvals", "registry.ts"), "utf8");
  const defined = everySourceFile(join(ROOT, "modules")).flatMap((path) => [...readFileSync(path, "utf8").matchAll(DEFINED)].map((match) => [match[1], path.slice(ROOT.length + 1)]));

  it("finds the definitions at all (the guard would otherwise be vacuous)", () => {
    expect(defined.length).toBeGreaterThan(5);
  });

  it.each(defined)("registers %s (%s)", (name) => {
    expect(registry).toMatch(new RegExp(`definition: ${name}\\b`));
  });
});
